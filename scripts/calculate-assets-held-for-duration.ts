import { BigNumber, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import fs from 'fs';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import BlockStore from '../src/lib/block-store';
import { ONE_ETH_WEI } from '../src/lib/constants';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import TokenAbi from './abis/isolation-mode-factory.json';
import './lib/env-reader';
import { MineralConfigFile } from './calculate-mineral-season-config';
import {
  getAccountBalancesByMarket,
  getAmmLiquidityPositionAndEvents,
  getArbVestingLiquidityPositionAndEvents,
  getBalanceChangingEvents,
} from './lib/event-parser';
import { readFileFromGitHub } from './lib/file-helpers';
import {
  ARB_VESTER_PROXY,
  calculateFinalPoints,
  calculateLiquidityPoints,
  calculateTotalRewardPoints,
  ETH_USDC_POOL, InterestOperation,
  LiquidityPositionsAndEvents,
} from './lib/rewards';

/* eslint-enable */

interface OutputFile {
  users: {
    [walletAddressLowercase: string]: string // big int
  };
  metadata: {
    marketId: number
    marketName: string // big int
    totalPointsForMarket: string // big int
    startBlock: number
    endBlock: number
    startTimestamp: number
    endTimestamp: number
  };
}

const FOLDER_NAME = `${__dirname}/output`;

async function start() {
  const liquidityMiningConfig = await readFileFromGitHub<MineralConfigFile>('config/mineral-season-0.json');

  const epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  if (Number.isNaN(epoch) || !liquidityMiningConfig.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }
  const maxMarketId = (await dolomite.getters.getNumMarkets()).toNumber();
  const validMarketId = parseInt(process.env.MARKET_ID ?? 'NaN', 10);
  if (Number.isNaN(validMarketId)) {
    return Promise.reject(new Error(`Invalid MARKET_ID, found: ${process.env.MARKET_ID}`));
  } else if (validMarketId >= maxMarketId) {
    return Promise.reject(new Error(`MARKET_ID contains an element that is too large, found: ${validMarketId}`));
  }

  const validRewardMultipliersMap = {
    [validMarketId]: INTEGERS.ONE,
  }

  const blockStore = new BlockStore();
  await blockStore._update();
  const marketStore = new MarketStore(blockStore);

  const startBlockNumber = liquidityMiningConfig.epochs[epoch].startBlockNumber;
  const startTimestamp = liquidityMiningConfig.epochs[epoch].startTimestamp;
  const endBlockNumber = liquidityMiningConfig.epochs[epoch].endBlockNumber;
  const endTimestamp = liquidityMiningConfig.epochs[epoch].endTimestamp;

  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (networkId !== Number(process.env.NETWORK_ID)) {
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
    marketId: validMarketId,
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

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(apiAccounts, startTimestamp, validRewardMultipliersMap);

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);

  const totalPointsPerMarket = calculateTotalRewardPoints(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    validRewardMultipliersMap,
    endTimestamp,
    InterestOperation.NOTHING,
  );
  const allMarketIds = Object.keys(totalPointsPerMarket);
  allMarketIds.forEach(marketId => {
    if (marketId !== validMarketId.toString()) {
      delete totalPointsPerMarket[marketId];
    }
  });

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

  const userToPointsMap = calculateFinalPoints(
    accountToDolomiteBalanceMap,
    validRewardMultipliersMap,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );
  const tokenAddress = await dolomite.getters.getMarketTokenAddress(new BigNumber(validMarketId));
  const token = new dolomite.web3.eth.Contract(TokenAbi, tokenAddress);
  const tokenName = await dolomite.contracts.callConstantContractFunction(token.methods.name());

  // eslint-disable-next-line max-len
  const fileName = `${FOLDER_NAME}/asset-held-${startTimestamp}-${endTimestamp}-${validMarketId}-output.json`;
  const dataToWrite = readOutputFile(fileName);
  dataToWrite.users = userToPointsMap;
  dataToWrite.metadata = {
    marketId: validMarketId,
    marketName: tokenName,
    totalPointsForMarket: totalPointsPerMarket[validMarketId].times(ONE_ETH_WEI).toFixed(0),
    startBlock: startBlockNumber,
    endBlock: endBlockNumber,
    startTimestamp: startTimestamp,
    endTimestamp: endTimestamp,
  }
  writeOutputFile(fileName, dataToWrite);

  return true;
}

function readOutputFile(fileName: string): OutputFile {
  try {
    return JSON.parse(fs.readFileSync(fileName, 'utf8')) as OutputFile;
  } catch (e) {
    return {
      users: {},
      metadata: {
        marketId: 0,
        marketName: '',
        totalPointsForMarket: '0',
        startBlock: 0,
        endBlock: 0,
        startTimestamp: 0,
        endTimestamp: 0,
      },
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
    console.error('Caught error while starting:', error);
    process.exit(1);
  });
