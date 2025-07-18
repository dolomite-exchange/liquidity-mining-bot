import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { parseEther } from 'ethers/lib/utils';
import v8 from 'v8';
import { getBlockDataByBlockNumber, getLatestBlockDataByTimestamp } from '../src/clients/blocks';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { ONE_WEEK_SECONDS } from '../src/lib/constants';
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
  const startBlockNumber = (await getLatestBlockDataByTimestamp(startTimestamp)).blockNumber;
  const endTimestamp = startTimestamp + ONE_WEEK_SECONDS;
  const endBlockNumber = (await getLatestBlockDataByTimestamp(endTimestamp)).blockNumber;

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
  } catch (e) {}

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
  })

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

  const poolToVirtualLiquidityPositionsAndEvents = await getPoolAddressToVirtualLiquidityPositionsAndEvents(
    networkId,
    startBlockNumber,
    startTimestamp,
    endTimestamp,
    false,
  );

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

  const { merkleRoot, walletAddressToLeafMap } = await calculateMerkleRootAndLeafs(userToOTokenRewards);

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
