import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import BlockStore from '../src/lib/block-store';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import { isScript } from '../src/lib/env'
import { OTokenConfigFile, writeOTokenConfigToGitHub } from './calculate-otoken-season-config';
import {
  EpochMetadata,
  getOTokenConfigFileNameWithPath,
  getOTokenFinalizedFileNameWithPath,
  getOTokenMetadataFileNameWithPath,
  getOTokenTypeFromEnvironment,
  OTokenType,
} from './lib/config-helper';
import {
  getAccountBalancesByMarket,
  getAmmLiquidityPositionAndEvents,
  getArbVestingLiquidityPositionAndEvents,
  getBalanceChangingEvents,
} from './lib/event-parser';
import { readFileFromGitHub, writeFileToGitHub } from './lib/file-helpers';
import {
  ARB_VESTER_PROXY,
  calculateFinalEquityRewards,
  calculateLiquidityPoints,
  calculateMerkleRootAndProofs,
  processEventsAndCalculateTotalRewardPoints,
  ETH_USDC_POOL,
  InterestOperation,
  LiquidityPositionsAndEvents,
} from './lib/rewards';

export interface OTokenEpochMetadata extends EpochMetadata {
  deltas: number[]
}

export interface OTokenOutputFile {
  users: {
    [walletAddressLowercase: string]: {
      amount: string // big int
      proofs: string[]
    }
  };
  metadata: {
    epoch: number;
    merkleRoot: string | null;
    marketTotalPointsForEpoch: {
      [market: string]: string // big int
    }
  };
}

const MINIMUM_O_TOKEN_AMOUNT_WEI = new BigNumber(ethers.utils.parseEther('0.01').toString());

const REWARD_MULTIPLIERS_MAP = {};

async function start() {
  const oTokenType = getOTokenTypeFromEnvironment();

  const networkId = await dolomite.web3.eth.net.getId();
  const oTokenConfig = await readFileFromGitHub<OTokenConfigFile>(
    getOTokenConfigFileNameWithPath(networkId, oTokenType as any),
  );

  const epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  if (Number.isNaN(epoch) || !oTokenConfig.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const blockStore = new BlockStore();
  await blockStore._update();

  const marketStore = new MarketStore(blockStore);

  const {
    startBlockNumber,
    startTimestamp,
    endBlockNumber,
    endTimestamp,
    oTokenAmount,
  } = oTokenConfig.epochs[epoch];

  const totalOARbAmount = new BigNumber(oTokenConfig.epochs[epoch].oTokenAmount);
  const rewardWeights = oTokenConfig.epochs[epoch].rewardWeights as Record<string, string>;
  const [
    oTokenRewardWeiMap,
    sumOfWeights,
  ] = Object.keys(rewardWeights).reduce<[Record<string, BigNumber>, BigNumber]>(([acc, sum], key) => {
    acc[key] = new BigNumber(parseEther(rewardWeights[key]).toString());
    return [acc, sum.plus(rewardWeights[key])];
  }, [{}, new BigNumber(0)]);
  if (!totalOARbAmount.eq(sumOfWeights)) {
    return Promise.reject(new Error(`Invalid reward weights sum, found: ${sumOfWeights.toString()}`));
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
    message: 'DolomiteMargin data',
    blockRewardStart: startBlockNumber,
    blockRewardStartTimestamp: startTimestamp,
    blockRewardEnd: endBlockNumber,
    blockRewardEndTimestamp: endTimestamp,
    dolomiteMargin: libraryDolomiteMargin,
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

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(apiAccounts, startTimestamp, REWARD_MULTIPLIERS_MAP);

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);

  const totalPointsPerMarket = processEventsAndCalculateTotalRewardPoints(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    REWARD_MULTIPLIERS_MAP,
    endTimestamp,
    InterestOperation.NOTHING,
  );

  const ammLiquidityBalancesAndEvents = await getAmmLiquidityPositionAndEvents(
    startBlockNumber,
    startTimestamp,
    endTimestamp,
  );

  const vestingPositionsAndEvents = await getArbVestingLiquidityPositionAndEvents(
    startBlockNumber,
    startTimestamp,
    endTimestamp,
  );

  const poolToVirtualLiquidityPositionsAndEvents: Record<string, LiquidityPositionsAndEvents> = {
    [ETH_USDC_POOL]: ammLiquidityBalancesAndEvents,
    [ARB_VESTER_PROXY]: vestingPositionsAndEvents,
  };

  const poolToTotalSubLiquidityPoints = calculateLiquidityPoints(
    poolToVirtualLiquidityPositionsAndEvents,
    startTimestamp,
    endTimestamp,
  );

  const userToOTokenRewards = calculateFinalEquityRewards(
    networkId,
    accountToDolomiteBalanceMap,
    poolToVirtualLiquidityPositionsAndEvents,
    totalPointsPerMarket,
    poolToTotalSubLiquidityPoints,
    oTokenRewardWeiMap,
    MINIMUM_O_TOKEN_AMOUNT_WEI,
  );

  const { merkleRoot, walletAddressToLeavesMap } = calculateMerkleRootAndProofs(userToOTokenRewards);

  const fileName = getOTokenFinalizedFileNameWithPath(networkId, OTokenType.oARB, epoch);
  const dataToWrite: OTokenOutputFile = {
    users: walletAddressToLeavesMap,
    metadata: {
      epoch,
      merkleRoot,
      marketTotalPointsForEpoch: {
        ...Object.keys(totalPointsPerMarket).reduce((acc, market) => {
          acc[market] = totalPointsPerMarket[market].toString();
          return acc;
        }, {}),
      },
    },
  };
  await writeFileToGitHub(fileName, dataToWrite, false);

  if (merkleRoot) {
    oTokenConfig.epochs[epoch].isMerkleRootGenerated = true;
    await writeOTokenConfigToGitHub(oTokenConfig, oTokenConfig.epochs[epoch]);
  }

  if (merkleRoot) {
    // TODO: write merkle root to chain
    // TODO: move this to another file that can be invoked via script or `MineralsMerkleUpdater` (pings every 15 seconds
    //  for an update)

    const metadataFilePath = getOTokenMetadataFileNameWithPath(networkId, oTokenType);
    const metadata = await readFileFromGitHub<OTokenEpochMetadata>(metadataFilePath);

    // Once the merkle root is written, update the metadata to the new highest epoch that is finalized
    if (metadata.maxEpochNumber === epoch - 1) {
      metadata.maxEpochNumber = epoch;
    }
    await writeFileToGitHub(metadataFilePath, metadata, true)
  }

  return true;
}

if (isScript()) {
  start()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
