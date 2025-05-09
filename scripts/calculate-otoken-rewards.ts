import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { parseEther } from 'ethers/lib/utils';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import BlockStore from '../src/lib/stores/block-store';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/stores/market-store';
import Pageable from '../src/lib/pageable';
import {
  getOTokenConfigFileNameWithPath,
  getOTokenFinalizedFileNameWithPath,
  getOTokenTypeFromEnvironment,
  getSeasonForOTokenType,
  writeOTokenConfigToGitHub,
} from './lib/config-helper';
import { OTokenConfigFile, OTokenOutputFile, OTokenType } from './lib/data-types';
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
import { calculateMerkleRootAndProofs } from './lib/utils';

const REWARD_MULTIPLIERS_MAP = {};

export async function calculateOTokenRewards(
  oTokenType: OTokenType = getOTokenTypeFromEnvironment(),
  epoch: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
): Promise<{
  epoch: number;
  merkleRoot: string | null
}> {
  const networkId = dolomite.networkId;
  const oTokenConfig = await readFileFromGitHub<OTokenConfigFile>(
    getOTokenConfigFileNameWithPath(networkId, oTokenType),
  );

  if (Number.isNaN(epoch) || !oTokenConfig.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const blockStore = new BlockStore();
  await blockStore._update();

  const marketStore = new MarketStore(blockStore, true);

  const {
    startBlockNumber,
    startTimestamp,
    endBlockNumber,
    endTimestamp,
    oTokenAmount,
  } = oTokenConfig.epochs[epoch];

  const totalOTokenAmount = new BigNumber(oTokenConfig.epochs[epoch].oTokenAmount);
  const rewardWeights = oTokenConfig.epochs[epoch].rewardWeights as Record<string, string>;
  const [
    oTokenRewardWeiMap,
    sumOfWeights,
  ]: [Record<string, Integer>, Decimal] = Object.keys(rewardWeights).reduce(([acc, sum], key) => {
    acc[key] = new BigNumber(parseEther(rewardWeights[key]).toString());
    return [acc, sum.plus(rewardWeights[key])];
  }, [{}, new BigNumber(0)] as [Record<string, Integer>, Decimal]);
  if (!totalOTokenAmount.eq(sumOfWeights)) {
    return Promise.reject(new Error(`Invalid reward weights sum, found: ${sumOfWeights.toFixed()} but expected ${totalOTokenAmount.toFixed()}`));
  }
  const defaultEquityPerSecond = Object.keys(rewardWeights).reduce((memo, key) => {
    memo[key] = INTEGERS.ONE;
    return memo;
  }, {} as Record<string, Decimal>);

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
    message: `DolomiteMargin data for ${oTokenType} rewards`,
    blockRewardStart: startBlockNumber,
    blockRewardStartTimestamp: startTimestamp,
    blockRewardEnd: endBlockNumber,
    blockRewardEndTimestamp: endTimestamp,
    dolomiteMargin: libraryDolomiteMargin,
    epochNumber: epoch,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    oTokenAmount,
    rewardWeights,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update(startBlockNumber);
  const startMarketMap = marketStore.getMarketMap();
  const startMarketIndexMap = await marketStore.getMarketIndexMap(startMarketMap, { blockNumber: startBlockNumber });

  await marketStore._update(endBlockNumber);
  const endMarketMap = marketStore.getMarketMap();
  const endMarketIndexMap = await marketStore.getMarketIndexMap(endMarketMap, { blockNumber: endBlockNumber });

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
    defaultEquityPerSecond,
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

  const userToOTokenRewards = Object.keys(userToMarketToPointsMap).reduce<Record<string, Integer>>((memo, user) => {
    Object.keys(userToMarketToPointsMap[user]).forEach(market => {
      const userPoints = userToMarketToPointsMap[user][market];
      const totalPoints = marketToPointsMap[market];
      if (!memo[user]) {
        memo[user] = INTEGERS.ZERO;
      }

      memo[user] = memo[user].plus(oTokenRewardWeiMap[market].times(userPoints).div(totalPoints));
    });
    return memo;
  }, {});

  const { merkleRoot, walletAddressToProofsMap } = await calculateMerkleRootAndProofs(userToOTokenRewards);

  const oTokenFileName = getOTokenFinalizedFileNameWithPath(networkId, oTokenType, epoch);
  const oTokenOutputFile: OTokenOutputFile = {
    users: walletAddressToProofsMap,
    metadata: {
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
      message: 'Skipping output file upload due to script execution',
    });
    const season = getSeasonForOTokenType(oTokenType);
    writeOutputFile(`${oTokenType}-${networkId}-season-${season}-epoch-${epoch}-output.json`, oTokenOutputFile);
  }

  if (merkleRoot) {
    oTokenConfig.epochs[epoch].isMerkleRootGenerated = true;
    if (!isScript() || shouldForceUpload()) {
      await writeOTokenConfigToGitHub(oTokenConfig, oTokenConfig.epochs[epoch]);
    } else {
      Logger.info({
        message: 'Skipping config file upload due to script execution',
      });
      const season = getSeasonForOTokenType(oTokenType);
      writeOutputFile(
        `${oTokenType}-${networkId}-season-${season}-config.json`,
        oTokenConfig,
        2,
      );
    }
  }


  return { epoch, merkleRoot };
}

if (isScript()) {
  calculateOTokenRewards(OTokenType.oARB)
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
