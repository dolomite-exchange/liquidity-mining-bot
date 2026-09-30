import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { parseEther } from 'ethers/lib/utils';
import { getLatestBlockDataByTimestamp } from '../src/clients/blocks';
import { getAllDolomiteAccountsWithSupplyValue } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { ONE_ETH_WEI, ONE_WEEK_SECONDS } from '../src/lib/constants';
import { isScript } from '../src/lib/env';
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import BlockStore from '../src/lib/stores/block-store';
import MarketStore from '../src/lib/stores/market-store';
import { ApiAccount } from '../src/lib/api-types';
import { readODoloMetadataFromApi } from './lib/api-helpers';
import { OTokenType } from './lib/data-types';
import {
  getAccountBalancesByMarket,
  getBalanceChangingEvents,
  getPoolAddressToVirtualLiquidityPositionsAndEvents,
} from './lib/event-parser';
import { setupRemapping } from './lib/remapper';
import {
  calculateFinalPoints,
  calculateVirtualLiquidityPoints,
  InterestOperation,
  processEventsUntilEndTimestamp,
} from './lib/rewards';

/*
 * ─── Diagnostic: who inflated a market's oDOLO points for an epoch? ──────────
 *
 * Read-only. Replays the exact per-network points pipeline for one epoch (same
 * functions as `calculate-odolo-rewards-per-network`), then dumps the per-account
 * contributions to a target market so an anomalous points spike can be traced to
 * its source. A market's weekly oDOLO is fixed and split by points share, so one
 * account with a corrupt (huge) balance snapshot silently dilutes every honest
 * supplier — this is what collapsed legitimate WBTC (market 4) rewards in epoch
 * 63 (points implied ~20,000 WBTC on a market that holds ~60).
 *
 * For each top account it prints the reward points, the implied average balance
 * (points ÷ epochSeconds, in whole tokens), the RAW start-of-epoch balance from
 * the snapshot, and the final balance after events — so you can tell whether the
 * inflation came from a bad start-block snapshot, a bad balance-changing event,
 * or a virtual-liquidity position.
 *
 * Usage:
 *   NETWORK_ID=42161 EPOCH_NUMBER=63 ODOLO_DIAGNOSE_MARKET=4 \
 *     SCRIPT=true npx ts-node scripts/diagnose-odolo-market-points.ts
 */

const ODOLO_TYPE = OTokenType.oDOLO;
const TOP_N = Number(process.env.ODOLO_DIAGNOSE_TOP_N ?? '20');

interface AccountMarketPoints {
  owner: string;
  accountNumber: string;
  effectiveUser: string;
  rewardPoints: BigNumber; // balancePar × secondsHeld (whole tokens · seconds)
  startBalancePar: BigNumber; // whole-token par at the epoch start block
  finalBalancePar: BigNumber; // whole-token par after processing events
}

function toWhole(par: Integer, decimals: number): BigNumber {
  return par.dividedBy(new BigNumber(10).pow(decimals));
}

export async function diagnoseODoloMarketPoints(): Promise<void> {
  const { networkId } = dolomite;
  const epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  const targetMarket = (process.env.ODOLO_DIAGNOSE_MARKET ?? '4').toString();
  if (Number.isNaN(epoch)) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${process.env.EPOCH_NUMBER}`));
  }

  const oDoloConfig = await readODoloMetadataFromApi(epoch);

  const blockStore = new BlockStore();
  await blockStore._update();
  const marketStore = new MarketStore(blockStore, true);

  const startTimestamp = oDoloConfig.epochStartTimestamp;
  const startBlockNumber = (await getLatestBlockDataByTimestamp(startTimestamp))!.blockNumber;
  const endTimestamp = startTimestamp + ONE_WEEK_SECONDS;
  const endBlockNumber = (await getLatestBlockDataByTimestamp(endTimestamp))!.blockNumber;
  const epochSeconds = endTimestamp - startTimestamp;

  await marketStore._update(startBlockNumber);
  const startMarketMap = marketStore.getMarketMap();
  const startMarketIndexMap = await marketStore.getMarketIndexMap(startMarketMap, { blockNumber: startBlockNumber });

  await marketStore._update(endBlockNumber);
  const endMarketMap = marketStore.getMarketMap();
  const endMarketIndexMap = await marketStore.getMarketIndexMap(endMarketMap, { blockNumber: endBlockNumber });

  const decimals = (endMarketMap[targetMarket] ?? startMarketMap[targetMarket])?.decimals ?? 18;

  const tokenAddressToMarketMap = marketStore.getTokenAddressToMarketMap();
  const tokenAddressToRewardMap = oDoloConfig.allChainWeights[networkId as ChainId];
  const marketToPointsPerSecondMap: Record<string, Integer> = {};
  const oTokenRewardWeiMap: Record<string, Integer> = Object.keys(tokenAddressToRewardMap).reduce((acc, tokenAddress) => {
    const { marketId } = tokenAddressToMarketMap[tokenAddress.toLowerCase()];
    acc[marketId] = new BigNumber(parseEther(tokenAddressToRewardMap[tokenAddress].toFixed(18)).toString());
    marketToPointsPerSecondMap[marketId] = INTEGERS.ONE;
    return acc;
  }, {} as Record<string, Integer>);

  const apiAccounts = await Pageable.getPageableValues(async (lastId) => {
    const result = await getAllDolomiteAccountsWithSupplyValue(startMarketIndexMap, startBlockNumber, lastId);
    return result.accounts;
  });

  // Capture the RAW start-of-epoch balance for the target market, keyed by
  // owner+number, straight from the snapshot — before any processing.
  const startParByAccount: Record<string, BigNumber> = {};
  apiAccounts.forEach((account: ApiAccount) => {
    const balance = account.balances[targetMarket];
    if (balance) {
      startParByAccount[`${account.owner}-${account.number.toString()}`] = toWhole(balance.par, decimals);
    }
  });

  await setupRemapping(networkId, endBlockNumber);

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(apiAccounts, startTimestamp, {});
  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);
  processEventsUntilEndTimestamp(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    marketToPointsPerSecondMap,
    endTimestamp,
    InterestOperation.NOTHING,
  );

  // Collect every account's real-balance contribution to the target market.
  const contributions: AccountMarketPoints[] = [];
  let realMarketPoints = INTEGERS.ZERO;
  Object.keys(accountToDolomiteBalanceMap).forEach(owner => {
    Object.keys(accountToDolomiteBalanceMap[owner]!).forEach(accountNumber => {
      const struct = accountToDolomiteBalanceMap[owner]![accountNumber]![targetMarket];
      if (struct) {
        realMarketPoints = realMarketPoints.plus(struct.rewardPoints);
        contributions.push({
          owner,
          accountNumber,
          effectiveUser: struct.effectiveUser,
          rewardPoints: struct.rewardPoints,
          startBalancePar: startParByAccount[`${owner}-${accountNumber}`] ?? INTEGERS.ZERO,
          finalBalancePar: struct.balancePar,
        });
      }
    });
  });
  contributions.sort((a, b) => (b.rewardPoints.gt(a.rewardPoints) ? 1 : -1));

  // Full pipeline (adds virtual-liquidity pool points) to reconcile against the
  // finalized epoch file's marketTotalPointsForEpoch.
  const poolToVirtualLiquidityPositionsAndEvents = await getPoolAddressToVirtualLiquidityPositionsAndEvents(
    networkId,
    startBlockNumber,
    startTimestamp,
    endTimestamp,
    false,
  );
  const poolToTotalSubLiquidityPoints = calculateVirtualLiquidityPoints(
    poolToVirtualLiquidityPositionsAndEvents,
    startTimestamp,
    endTimestamp,
  );
  const { marketToPointsMap } = calculateFinalPoints(
    networkId,
    accountToDolomiteBalanceMap,
    oTokenRewardWeiMap,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );

  const finalMarketPoints = marketToPointsMap[targetMarket] ?? INTEGERS.ZERO;
  const realImpliedSupply = realMarketPoints.dividedBy(epochSeconds);
  const finalImpliedSupply = finalMarketPoints.dividedBy(ONE_ETH_WEI.times(epochSeconds));
  const symbol = (endMarketMap[targetMarket] ?? startMarketMap[targetMarket])?.symbol ?? `market ${targetMarket}`;

  // Completeness self-check. `getAllDolomiteAccountsWithSupplyValue` paginates and
  // `Pageable` stops as soon as a page returns < MAX_PAGE_SIZE rows — so a subgraph
  // that returns short pages for the heavy historical query (rate limit / timeout /
  // pruned old block) silently truncates the account set. Cross-check the fetched
  // supply against the market's actual on-chain total par (independent of the
  // subgraph): if it's far below, the fetch is incomplete and the table below is
  // NOT trustworthy (this is what produced the 9-vs-60 WBTC epoch-62 smoke test).
  const totalPar = await dolomite.getters.getMarketTotalPar(new BigNumber(targetMarket), {
    blockNumber: endBlockNumber,
  });
  const onChainSupplyPar = totalPar.supply.dividedBy(new BigNumber(10).pow(decimals));
  const fetchLooksIncomplete = onChainSupplyPar.gt(INTEGERS.ZERO)
    && realImpliedSupply.lt(onChainSupplyPar.times(new BigNumber('0.5')));

  Logger.info({
    at: __filename,
    message: 'oDOLO market-points diagnosis',
    epoch,
    networkId,
    market: targetMarket,
    symbol,
    startBlockNumber,
    endBlockNumber,
    realBalanceImpliedAvgSupply: realImpliedSupply.toFixed(2),
    finalImpliedAvgSupply: finalImpliedSupply.toFixed(2),
    onChainSupplyPar: onChainSupplyPar.toFixed(2),
    virtualLiquidityInflated: finalImpliedSupply.minus(realImpliedSupply).toFixed(2),
    finalMarketTotalPoints: finalMarketPoints.toFixed(),
  });

  if (fetchLooksIncomplete) {
    Logger.error({
      at: __filename,
      message: 'INCOMPLETE ACCOUNT FETCH — results below are UNRELIABLE. Fetched supply is far below on-chain, so '
        + 'the subgraph returned short pages and pagination stopped early. Re-run against a complete/faster '
        + 'SUBGRAPH_URL before trusting the output.',
      market: targetMarket,
      fetchedImpliedSupply: realImpliedSupply.toFixed(2),
      onChainSupplyPar: onChainSupplyPar.toFixed(2),
    });
  }

  console.log(`\n=== Top ${TOP_N} real-balance contributors to ${symbol} (market ${targetMarket}) — epoch ${epoch} ===`);
  console.log(
    `${'implAvgBal'.padStart(16)} ${'startPar'.padStart(16)} ${'finalPar'.padStart(16)}  account (effectiveUser)`,
  );
  contributions.slice(0, TOP_N).forEach(c => {
    const implAvgBal = c.rewardPoints.dividedBy(epochSeconds);
    const flag = implAvgBal.gt(realImpliedSupply.times(new BigNumber('0.5'))) ? '  <== dominates market' : '';
    console.log(
      `${implAvgBal.toFixed(4).padStart(16)} ${c.startBalancePar.toFixed(4).padStart(16)} `
      + `${c.finalBalancePar.toFixed(4).padStart(16)}  ${c.owner}#${c.accountNumber} (${c.effectiveUser})${flag}`,
    );
  });
  console.log(
    `\nReal-balance implied avg supply: ${realImpliedSupply.toFixed(2)} ${symbol}; `
    + `final (incl. virtual liquidity): ${finalImpliedSupply.toFixed(2)} ${symbol}.`,
  );
  console.log(
    'If a single account shows an implausible startPar, the corrupt value is in the epoch-start snapshot '
    + '(getAllDolomiteAccountsWithSupplyValue). If startPar is sane but implAvgBal is huge, the inflation came '
    + 'from a balance-changing event. If real implied supply is sane but final is not, it came from virtual liquidity.',
  );
}

if (isScript()) {
  diagnoseODoloMarketPoints()
    .then(() => {
      console.log(`Finished executing script for ${ODOLO_TYPE}!`);
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
