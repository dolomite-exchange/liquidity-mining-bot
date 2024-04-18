import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import fs from 'fs';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import BlockStore from '../src/lib/block-store';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import liquidityMiningConfig from './config/oarb-season-0.json';
import './lib/env-reader';
import {
  getAccountBalancesByMarket,
  getAmmLiquidityPositionAndEvents,
  getArbVestingLiquidityPositionAndEvents,
  getBalanceChangingEvents,
} from './lib/event-parser';
import {
  ARB_VESTER_PROXY,
  calculateFinalRewards,
  calculateLiquidityPoints,
  calculateMerkleRootAndProofs,
  calculateTotalRewardPoints,
  ETH_USDC_POOL, InterestOperation,
  LiquidityPositionsAndEvents,
} from './lib/rewards';

interface OutputFile {
  epochs: {
    [epoch: string]: {
      [walletAddressLowercase: string]: {
        amount: string // big int
        proofs: string[]
      }
    }
  };
  metadata: {
    [epoch: string]: {
      isFinalized: boolean
      merkleRoot: string
      marketTotalPointsForEpoch: {
        [market: string]: string // big int
      }
    }
  };
}

const FOLDER_NAME = `${__dirname}/output`;

const MINIMUM_O_TOKEN_AMOUNT_WEI = new BigNumber(ethers.utils.parseEther('0.01').toString());

const REWARD_MULTIPLIERS_MAP = {};

async function start() {
  const epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  if (Number.isNaN(epoch) || !liquidityMiningConfig.epochs[epoch]) {
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
    oArbAmount,
  } = liquidityMiningConfig.epochs[epoch];

  const totalOARbAmount = new BigNumber(liquidityMiningConfig.epochs[epoch].oArbAmount);
  const rewardWeights = liquidityMiningConfig.epochs[epoch].rewardWeights as Record<string, string>;
  const [oTokenRewardWeiMap, sumOfWeights] = Object.keys(rewardWeights)
    .reduce<[Record<string, BigNumber>, BigNumber]>(([acc, sum], key) => {
      acc[key] = new BigNumber(parseEther(rewardWeights[key]).toString());
      return [acc, sum.plus(rewardWeights[key])];
    }, [{}, new BigNumber(0)]);
  if (!totalOARbAmount.eq(sumOfWeights)) {
    return Promise.reject(new Error(`Invalid reward weights sum, found: ${sumOfWeights.toString()}`));
  }

  const { riskParams } = await getDolomiteRiskParams(startBlockNumber);
  const networkId = await dolomite.web3.eth.net.getId();

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
    oArbAmount,
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

  const totalPointsPerMarket = calculateTotalRewardPoints(
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

  const userToOTokenRewards = calculateFinalRewards(
    accountToDolomiteBalanceMap,
    poolToVirtualLiquidityPositionsAndEvents,
    totalPointsPerMarket,
    poolToTotalSubLiquidityPoints,
    oTokenRewardWeiMap,
    MINIMUM_O_TOKEN_AMOUNT_WEI,
  );

  const { merkleRoot, walletAddressToLeavesMap } = calculateMerkleRootAndProofs(userToOTokenRewards);

  const fileName = `${FOLDER_NAME}/oarb-season-0-epoch-${epoch}-output.json`;
  const dataToWrite = readOutputFile(fileName);
  dataToWrite.epochs[epoch] = walletAddressToLeavesMap;
  dataToWrite.metadata[epoch] = {
    merkleRoot,
    isFinalized: true,
    marketTotalPointsForEpoch: {
      ...Object.keys(totalPointsPerMarket).reduce((acc, market) => {
        acc[market] = totalPointsPerMarket[market].toString();
        return acc;
      }, {}),
    }
  };
  writeOutputFile(fileName, dataToWrite);

  return true;
}

function readOutputFile(fileName: string): OutputFile {
  try {
    return JSON.parse(fs.readFileSync(fileName, 'utf8')) as OutputFile;
  } catch (e) {
    return {
      epochs: {},
      metadata: {},
    };
  }
}

function writeOutputFile(
  fileName: string,
  fileContent: OutputFile,
): void {
  if (!fs.existsSync(FOLDER_NAME)) {
    fs.mkdirSync(FOLDER_NAME);
  }

  fs.writeFileSync(
    fileName,
    JSON.stringify(fileContent),
    { encoding: 'utf8', flag: 'w' },
  );
}

start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Caught error while running:`, error);
    process.exit(1);
  });
