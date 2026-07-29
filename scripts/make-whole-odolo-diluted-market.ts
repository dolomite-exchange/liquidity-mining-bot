import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { parseEther } from 'ethers/lib/utils';
import { getLatestBlockDataByTimestamp } from '../src/clients/blocks';
import { getAllDolomiteAccountsWithSupplyValue } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { ONE_WEEK_SECONDS } from '../src/lib/constants';
import { isScript } from '../src/lib/env';
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import BlockStore from '../src/lib/stores/block-store';
import MarketStore from '../src/lib/stores/market-store';
import { readODoloMetadataFromApi } from './lib/api-helpers';
import { getOTokenFinalizedFileNameWithPath } from './lib/config-helper';
import { ODoloOutputFile, OTokenType } from './lib/data-types';
import {
  getAccountBalancesByMarket,
  getBalanceChangingEvents,
  getPoolAddressToVirtualLiquidityPositionsAndEvents,
} from './lib/event-parser';
import { readFileFromGitHub, writeOutputFile } from './lib/file-helpers';
import { setupRemapping } from './lib/remapper';
import {
  addToBlacklist,
  calculateFinalPoints,
  calculateVirtualLiquidityPoints,
  InterestOperation,
  processEventsUntilEndTimestamp,
} from './lib/rewards';

/*
 * ─── Make honest suppliers whole after a diluted-market epoch ────────────────
 *
 * Read-only compute (writes only a dry-run artifact to scripts/output). When a
 * corrupt balance snapshot inflated a market's total oDOLO points for an epoch,
 * that market's FIXED weekly oDOLO was split across the inflated points, so every
 * honest supplier was under-paid by roughly (dilutedPoints / correctedPoints).
 * This happened to WBTC (market 4) in epochs 56 and 63.
 *
 * Given the offending account(s) — from `diagnose-odolo-market-points` — this
 * recomputes each affected epoch with them EXCLUDED (via the existing blacklist),
 * then for every market whose total collapses once they're removed it computes
 * each user's shortfall:
 *
 *   shortfall_user = weight[m] × userPoints[m] × (1/correctedTotal − 1/dilutedTotal)
 *
 * (`correctedTotal` = recomputed points with the offender excluded;
 * `dilutedTotal`   = the published epoch file's marketTotalPointsForEpoch.)
 * The per-user shortfalls are summed across the affected epochs and written out as
 * a backfill map for review.
 *
 * Requirements + rollout:
 *   - Needs the same env as the reward calc (archive RPC + subgraph at the epoch
 *     blocks) and the offending account list from the diagnostic.
 *   - oDOLO is a cumulative merkle drop and the per-network cumulative is additive
 *     (`cumulative[N] = cumulative[N-1] + increment[N]`), so the published epoch
 *     56/63 roots stay untouched. Deliver the backfill by ADDING each user's
 *     shortfall to their current oDOLO cumulative (the same shape as the
 *     `rectify-*` scripts), which then propagates on-chain through the normal
 *     next-epoch aggregation + merkle-tree updater. Review the dry-run map before
 *     applying.
 *
 * Usage:
 *   NETWORK_ID=42161 \
 *   ODOLO_MAKEWHOLE_EXCLUDE=0x<offending-account>[,0x<more>] \
 *   ODOLO_MAKEWHOLE_EPOCHS=56,63 \
 *     SCRIPT=true npx ts-node scripts/make-whole-odolo-diluted-market.ts
 */

const ODOLO_TYPE = OTokenType.oDOLO;
// A market counts as "diluted" only if removing the offending account(s) shrinks
// its total points by more than this factor — so a normal epoch/market is never
// touched. Matches the publish-time guard's default.
const ANOMALY_FACTOR = new BigNumber(process.env.ODOLO_MAKEWHOLE_ANOMALY_FACTOR ?? '10');

/** Recompute one epoch with the offending accounts excluded; returns per-market points. */
export async function computeCorrectedEpochPoints(epoch: number): Promise<{
  userToMarketToPointsMap: Record<string, Record<string, Integer>>;
  marketToPointsMap: Record<string, Integer>;
  oTokenRewardWeiMap: Record<string, Integer>;
}> {
  const { networkId } = dolomite;
  const oDoloConfig = await readODoloMetadataFromApi(epoch);

  const blockStore = new BlockStore();
  await blockStore._update();
  const marketStore = new MarketStore(blockStore, true);

  // Deterministic epoch window (avoids relying on the API returning a historical
  // epochStartTimestamp for a past epoch query).
  const startTimestamp = oDoloConfig.odoloStartTimestamp + epoch * ONE_WEEK_SECONDS;
  const endTimestamp = startTimestamp + ONE_WEEK_SECONDS;
  const startBlockNumber = (await getLatestBlockDataByTimestamp(startTimestamp))!.blockNumber;
  const endBlockNumber = (await getLatestBlockDataByTimestamp(endTimestamp))!.blockNumber;

  await marketStore._update(startBlockNumber);
  const startMarketMap = marketStore.getMarketMap();
  const startMarketIndexMap = await marketStore.getMarketIndexMap(startMarketMap, { blockNumber: startBlockNumber });

  await marketStore._update(endBlockNumber);
  const endMarketIndexMap = await marketStore.getMarketIndexMap(marketStore.getMarketMap(), {
    blockNumber: endBlockNumber,
  });

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
  // Offending accounts are excluded here: `calculateFinalPoints` skips blacklisted
  // owners, so `marketToPointsMap` returns to its true (un-inflated) total.
  const { userToMarketToPointsMap, marketToPointsMap } = calculateFinalPoints(
    networkId,
    accountToDolomiteBalanceMap,
    oTokenRewardWeiMap,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );

  return { userToMarketToPointsMap, marketToPointsMap, oTokenRewardWeiMap };
}

export async function makeWholeODoloDilutedMarket(): Promise<void> {
  const { networkId } = dolomite;
  const excludeAccounts = (process.env.ODOLO_MAKEWHOLE_EXCLUDE ?? '')
    .split(',')
    .map(a => a.trim().toLowerCase())
    .filter(a => a.length > 0);
  const epochs = (process.env.ODOLO_MAKEWHOLE_EPOCHS ?? '56,63')
    .split(',')
    .map(e => parseInt(e.trim(), 10))
    .filter(e => !Number.isNaN(e));

  if (excludeAccounts.length === 0) {
    return Promise.reject(new Error(
      'ODOLO_MAKEWHOLE_EXCLUDE is required — pass the offending account(s) from diagnose-odolo-market-points',
    ));
  }
  excludeAccounts.forEach(addToBlacklist);

  const userToShortfall: Record<string, Integer> = {};
  const perEpochSummary: Record<number, { anomalousMarkets: string[]; restoredWei: string }> = {};

  for (let i = 0; i < epochs.length; i += 1) {
    const epoch = epochs[i];
    // eslint-disable-next-line no-await-in-loop
    const { userToMarketToPointsMap, marketToPointsMap, oTokenRewardWeiMap } = await computeCorrectedEpochPoints(epoch);
    // eslint-disable-next-line no-await-in-loop
    const publishedFile = await readFileFromGitHub<ODoloOutputFile>(
      getOTokenFinalizedFileNameWithPath(networkId, ODOLO_TYPE, epoch),
    );
    const dilutedTotals = publishedFile.metadata.marketTotalPointsForEpoch;

    const anomalousMarkets: string[] = [];
    let restoredWei = INTEGERS.ZERO;
    Object.keys(oTokenRewardWeiMap).forEach(market => {
      const correctedTotal = marketToPointsMap[market];
      const dilutedTotal = dilutedTotals[market] ? new BigNumber(dilutedTotals[market]) : undefined;
      if (
        !correctedTotal
        || correctedTotal.lte(INTEGERS.ZERO)
        || !dilutedTotal
        || dilutedTotal.lte(INTEGERS.ZERO)
        || dilutedTotal.dividedBy(correctedTotal).lte(ANOMALY_FACTOR)
      ) {
        // Market was not materially diluted by the excluded account(s) — leave it.
        return;
      }
      anomalousMarkets.push(market);

      const weight = oTokenRewardWeiMap[market];
      Object.keys(userToMarketToPointsMap).forEach(user => {
        const userPoints = userToMarketToPointsMap[user][market];
        if (!userPoints || userPoints.lte(INTEGERS.ZERO)) {
          return;
        }
        const correctedAmount = weight.times(userPoints).dividedToIntegerBy(correctedTotal);
        const dilutedAmount = weight.times(userPoints).dividedToIntegerBy(dilutedTotal);
        const shortfall = correctedAmount.minus(dilutedAmount);
        if (shortfall.gt(INTEGERS.ZERO)) {
          userToShortfall[user] = (userToShortfall[user] ?? INTEGERS.ZERO).plus(shortfall);
          restoredWei = restoredWei.plus(shortfall);
        }
      });
    });

    perEpochSummary[epoch] = { anomalousMarkets, restoredWei: restoredWei.toFixed() };
    Logger.info({
      at: __filename,
      message: `Computed make-whole shortfalls for epoch ${epoch}`,
      epoch,
      anomalousMarkets,
      restoredODolo: restoredWei.dividedBy(new BigNumber(10).pow(18)).toFixed(2),
    });
  }

  const totalWei = Object.keys(userToShortfall).reduce((acc, u) => acc.plus(userToShortfall[u]), INTEGERS.ZERO);
  const backfill = {
    metadata: {
      networkId,
      excludedAccounts: excludeAccounts,
      epochs,
      anomalyFactor: ANOMALY_FACTOR.toFixed(),
      totalUsers: Object.keys(userToShortfall).length,
      totalBackfillODolo: totalWei.dividedBy(new BigNumber(10).pow(18)).toFixed(),
      totalBackfillWei: totalWei.toFixed(),
      perEpoch: perEpochSummary,
    },
    users: Object.keys(userToShortfall).reduce((acc, user) => {
      acc[user] = userToShortfall[user].toFixed();
      return acc;
    }, {} as Record<string, string>),
  };

  Logger.info({
    at: __filename,
    message: 'Make-whole backfill computed (dry run — written to scripts/output)',
    totalUsers: backfill.metadata.totalUsers,
    totalBackfillODolo: backfill.metadata.totalBackfillODolo,
  });
  writeOutputFile(`odolo/odolo-${networkId}-makewhole-backfill.json`, backfill);
}

if (isScript()) {
  makeWholeODoloDilutedMarket()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
