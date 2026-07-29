import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { parseEther } from 'ethers/lib/utils';
import v8 from 'v8';
import { getBlockDataByBlockNumber, getLatestBlockDataByTimestamp } from '../src/clients/blocks';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { ONE_ETH_WEI, ONE_WEEK_SECONDS } from '../src/lib/constants';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import BlockStore from '../src/lib/stores/block-store';
import MarketStore from '../src/lib/stores/market-store';
import { readODoloMetadataFromApi } from './lib/api-helpers';
import { getOTokenFinalizedFileNameWithPath, getSeasonForOTokenType } from './lib/config-helper';
import { ODoloOutputFile, OTokenType } from './lib/data-types';
import {
  getAccountBalancesByMarket,
  getBalanceChangingEvents,
  getPoolAddressToVirtualLiquidityPositionsAndEvents,
} from './lib/event-parser';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import { setupRemapping } from './lib/remapper';
import {
  calculateFinalPoints,
  calculateVirtualLiquidityPoints,
  InterestOperation,
  processEventsUntilEndTimestamp,
} from './lib/rewards';
import { calculateMerkleRootAndLeafs } from './lib/utils';

const DEFAULT_EQUITY_PER_SECOND = INTEGERS.ONE;
const ODOLO_TYPE = OTokenType.oDOLO;
const REWARD_MULTIPLIERS_MAP = {};

export interface ODoloRewardsPerNetworkCalculation {
  epoch: number;
  merkleRoot: string | null
}

/**
 * Guards against a corrupt balance snapshot silently inflating a market's total
 * oDOLO points. Each market's weekly oDOLO is a FIXED amount split by points
 * share, so if one market's total points balloon, every honest supplier in that
 * market is diluted — this is what zeroed out legitimate WBTC (market 4) farmers
 * for epoch 63, where the points implied ~20,000 WBTC supplied on a market that
 * holds ~60.
 *
 * `points[market] = Σ (balancePar × secondsHeld × 1e18)`, so
 *   `impliedAvgSupplyPar = points[market] / (1e18 × epochSeconds)`
 * is the time-weighted average supplied balance (whole tokens, par) the points
 * claim. We cross-check it against the market's actual on-chain total supply par
 * at the epoch boundaries — an INDEPENDENT source, so a bad snapshot cannot hide
 * by also corrupting the reference. If the points imply a supply that can't
 * exist, refuse to publish the epoch (throw) and log loudly rather than ship a
 * diluted distribution. `ODOLO_POINTS_SANITY_FACTOR` (default 10) is the tolerated
 * multiple over real supply, leaving generous headroom for intra-week peaks.
 */
async function assertMarketPointsAreSane(
  marketIds: string[],
  marketToPointsMap: Record<string, Integer>,
  marketMap: { [marketId: string]: { decimals: number } },
  epochSeconds: number,
  startBlockNumber: number,
  endBlockNumber: number,
  epoch: number,
): Promise<void> {
  const sanityFactor = new BigNumber(process.env.ODOLO_POINTS_SANITY_FACTOR ?? '10');
  const pointsScale = ONE_ETH_WEI.times(epochSeconds);
  for (let i = 0; i < marketIds.length; i += 1) {
    const market = marketIds[i];
    const marketPoints = marketToPointsMap[market];
    if (!marketPoints || marketPoints.lte(INTEGERS.ZERO)) {
      continue;
    }

    const impliedAvgSupplyPar = marketPoints.dividedBy(pointsScale);
    const decimals = marketMap[market]?.decimals ?? 18;
    const divisor = new BigNumber(10).pow(decimals);
    // eslint-disable-next-line no-await-in-loop
    const [startPar, endPar] = await Promise.all([
      dolomite.getters.getMarketTotalPar(new BigNumber(market), { blockNumber: startBlockNumber }),
      dolomite.getters.getMarketTotalPar(new BigNumber(market), { blockNumber: endBlockNumber }),
    ]);
    const maxSupplyParRaw = startPar.supply.gt(endPar.supply) ? startPar.supply : endPar.supply;
    const actualSupplyPar = maxSupplyParRaw.dividedBy(divisor);
    const sanityCeiling = actualSupplyPar.times(sanityFactor);

    if (impliedAvgSupplyPar.gt(sanityCeiling)) {
      Logger.error({
        at: __filename,
        message: 'oDOLO market points imply an impossible supply — refusing to publish epoch',
        remediation: 'A corrupt start-of-epoch balance snapshot likely inflated this market’s points '
          + 'and would dilute every honest supplier. Run diagnose-odolo-market-points for this epoch '
          + 'to find the offending account before retrying.',
        epoch,
        market,
        impliedAvgSupplyPar: impliedAvgSupplyPar.toFixed(),
        actualSupplyPar: actualSupplyPar.toFixed(),
        sanityFactor: sanityFactor.toFixed(),
      });
      throw new Error(
        `oDOLO points sanity check failed for market ${market}: points imply avg supply `
        + `${impliedAvgSupplyPar.toFixed(2)} but on-chain supply is only ${actualSupplyPar.toFixed(2)} `
        + `(> ${sanityFactor.toFixed()}x)`,
      );
    }
  }
}

export async function calculateOdoloRewardsPerNetwork(
  epoch: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
): Promise<ODoloRewardsPerNetworkCalculation> {
  const { networkId } = dolomite;

  if (Number.isNaN(epoch)) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const oDoloConfig = await readODoloMetadataFromApi(epoch);

  const blockStore = new BlockStore();
  await blockStore._update();

  const marketStore = new MarketStore(blockStore, true);

  if (epoch === oDoloConfig.currentEpochIndex) {
    // There's nothing to do. The week has not passed yet
    Logger.info({
      file: __filename,
      message: 'Epoch has not passed yet. Returning...',
    });
    return { epoch, merkleRoot: null };
  }

  // We need to check if `newEndBlockNumberResult` is the last block of the week
  const startTimestamp = oDoloConfig.epochStartTimestamp;
  const startBlockNumber = (await getLatestBlockDataByTimestamp(startTimestamp))!.blockNumber;
  const endTimestamp = startTimestamp + ONE_WEEK_SECONDS;
  const endBlockNumber = (await getLatestBlockDataByTimestamp(endTimestamp))!.blockNumber;

  // The week is over if the block is at the end OR if the next block goes into next week
  const nextBlockData = await getBlockDataByBlockNumber(endBlockNumber + 1);
  const isTimeElapsed = !!nextBlockData && nextBlockData.timestamp > endTimestamp;
  if (!isTimeElapsed) {
    // There's nothing to do. The week has not passed yet
    Logger.info({
      file: __filename,
      message: 'Epoch has not passed yet. Returning...',
    });
    return { epoch, merkleRoot: null };
  }

  const oTokenFileName = getOTokenFinalizedFileNameWithPath(networkId, ODOLO_TYPE, epoch);
  let hasFile = false;
  try {
    await readFileFromGitHub(oTokenFileName)
    hasFile = true;
    // eslint-disable-next-line no-empty
  } catch (e) {
  }

  if (hasFile && !shouldForceUpload()) {
    Logger.info({
      file: __filename,
      message: 'Epoch rewards have already been calculated. Returning...',
      epoch,
    });

    return { epoch, merkleRoot: null };
  }

  const { riskParams } = await getDolomiteRiskParams(startBlockNumber);

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (riskParams.dolomiteMargin !== libraryDolomiteMargin) {
    const message = `Invalid dolomite margin address found!\n
    { network: ${riskParams.dolomiteMargin} library: ${libraryDolomiteMargin} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  } else if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    file: __filename,
    message: 'DolomiteMargin data for oDOLO rewards',
    blockRewardStart: startBlockNumber,
    blockRewardStartTimestamp: startTimestamp,
    blockRewardEnd: endBlockNumber,
    blockRewardEndTimestamp: endTimestamp,
    dolomiteMargin: libraryDolomiteMargin,
    epochNumber: epoch,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update(startBlockNumber);
  const startMarketMap = marketStore.getMarketMap();
  const startMarketIndexMap = await marketStore.getMarketIndexMap(startMarketMap, { blockNumber: startBlockNumber });

  await marketStore._update(endBlockNumber);
  const endMarketMap = marketStore.getMarketMap();
  const endMarketIndexMap = await marketStore.getMarketIndexMap(endMarketMap, { blockNumber: endBlockNumber });

  const tokenAddressToMarketMap = marketStore.getTokenAddressToMarketMap();
  const tokenAddressToRewardMap = oDoloConfig.allChainWeights[networkId as ChainId];
  const marketToPointsPerSecondMap: Record<string, Integer> = {};
  const oTokenRewardWeiMap: Record<string, Integer> = Object.keys(tokenAddressToRewardMap)
    .reduce((acc, tokenAddress) => {
      const { marketId } = tokenAddressToMarketMap[tokenAddress.toLowerCase()];
      acc[marketId] = new BigNumber(parseEther(tokenAddressToRewardMap[tokenAddress].toFixed(18)).toString());
      marketToPointsPerSecondMap[marketId] = DEFAULT_EQUITY_PER_SECOND;
      return acc;
    }, {} as Record<string, Integer>);
  Logger.info({
    file: __filename,
    message: 'oDOLO Rewards',
    tokenAddressToRewardMap,
  });

  const apiAccounts = await Pageable.getPageableValues(async (lastId) => {
    const result = await getAllDolomiteAccountsWithSupplyValue(startMarketIndexMap, startBlockNumber, lastId);
    return result.accounts;
  });

  await setupRemapping(networkId, endBlockNumber);

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(apiAccounts, startTimestamp, REWARD_MULTIPLIERS_MAP);

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);

  processEventsUntilEndTimestamp(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    marketToPointsPerSecondMap,
    endTimestamp,
    InterestOperation.NOTHING,
  );
  Logger.info({
    file: __filename,
    message: 'Processed accounts!',
  });

  const poolToVirtualLiquidityPositionsAndEvents = await getPoolAddressToVirtualLiquidityPositionsAndEvents(
    networkId,
    startBlockNumber,
    startTimestamp,
    endTimestamp,
    false,
  );
  Logger.info({
    file: __filename,
    message: 'Got virtual liquidity positions and events!',
  });

  const poolToTotalSubLiquidityPoints: Record<string, Decimal> = calculateVirtualLiquidityPoints(
    poolToVirtualLiquidityPositionsAndEvents,
    startTimestamp,
    endTimestamp,
  );

  const { userToMarketToPointsMap, marketToPointsMap } = calculateFinalPoints(
    networkId,
    accountToDolomiteBalanceMap,
    oTokenRewardWeiMap,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );
  Logger.info({
    file: __filename,
    message: 'Calculated final points!',
  });

  // Refuse to publish an epoch whose points imply an impossible supply for any
  // rewarded market — a single corrupt balance snapshot would otherwise silently
  // dilute every honest supplier in that market (see epoch-63 WBTC dilution).
  await assertMarketPointsAreSane(
    Object.keys(oTokenRewardWeiMap),
    marketToPointsMap,
    endMarketMap,
    endTimestamp - startTimestamp,
    startBlockNumber,
    endBlockNumber,
    epoch,
  );

  let cumulativeODolo = INTEGERS.ZERO;
  let previousUsers: Record<string, Integer> = {};
  const startEpoch = oDoloConfig.allChainStartEpochs[networkId as ChainId];
  if (startEpoch === null) {
    return Promise.reject(new Error(`Invalid start epoch for network ${networkId}`));
  }

  if (epoch >= startEpoch + 1) {
    const file = await readFileFromGitHub<ODoloOutputFile>(
      getOTokenFinalizedFileNameWithPath(networkId, ODOLO_TYPE, epoch - 1),
    );
    previousUsers = Object.keys(file.users).reduce((memo, user) => {
      memo[user] = new BigNumber(file.users[user].amount);
      cumulativeODolo = cumulativeODolo.plus(memo[user]);
      return memo;
    }, {} as Record<string, Integer>);
  }
  Logger.info({
    file: __filename,
    message: 'Calculated previous user data!',
  });

  let totalODolo = INTEGERS.ZERO;
  const userToOTokenRewards: Record<string, Integer> = Object.keys(userToMarketToPointsMap).reduce((memo, user) => {
    Object.keys(userToMarketToPointsMap[user]).forEach(market => {
      const userPoints = userToMarketToPointsMap[user][market];
      const totalPoints = marketToPointsMap[market];
      if (!memo[user]) {
        memo[user] = INTEGERS.ZERO;
      }

      const oDoloAmount = oTokenRewardWeiMap[market].times(userPoints).dividedToIntegerBy(totalPoints);
      totalODolo = totalODolo.plus(oDoloAmount);
      cumulativeODolo = cumulativeODolo.plus(oDoloAmount);

      memo[user] = memo[user].plus(oDoloAmount);

      if (memo[user].eq(INTEGERS.ZERO)) {
        // Remove the user if the balance is still zero
        delete memo[user];
      }
    });
    return memo;
  }, previousUsers);
  Logger.info({
    file: __filename,
    message: 'Calculated user to oDOLO amounts!',
  });

  const { merkleRoot, walletAddressToLeafMap } = await calculateMerkleRootAndLeafs(userToOTokenRewards);
  Logger.info({
    file: __filename,
    message: 'Calculated Merkle root!',
  });

  const oTokenOutputFile: ODoloOutputFile = {
    users: walletAddressToLeafMap,
    metadata: {
      totalUsers: Object.keys(walletAddressToLeafMap).length,
      totalODolo: totalODolo.toFixed(),
      cumulativeODolo: cumulativeODolo.toFixed(),
      epoch,
      merkleRoot,
      marketTotalPointsForEpoch: {
        ...Object.keys(marketToPointsMap).reduce((acc, market) => {
          acc[market] = marketToPointsMap[market].toString();
          return acc;
        }, {}),
      },
    },
  };

  if (!isScript() || shouldForceUpload()) {
    await writeFileToGitHub(oTokenFileName, oTokenOutputFile, false);
  } else {
    Logger.info({
      file: __filename,
      message: 'Skipping output file upload due to script execution',
    });
    const season = getSeasonForOTokenType(ODOLO_TYPE);
    writeOutputFile(`odolo/${ODOLO_TYPE}-${networkId}-season-${season}-epoch-${epoch}-output.json`, oTokenOutputFile);
  }

  return { epoch, merkleRoot };
}

if (isScript()) {
  calculateOdoloRewardsPerNetwork()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
