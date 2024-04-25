import { BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import fs from 'fs';
import v8 from 'v8';
import { getLatestBlockNumberByTimestamp } from '../src/clients/blocks';
import { getAllDolomiteAccountsWithSupplyValue } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import BlockStore from '../src/lib/block-store';
import { ONE_ETH_WEI } from '../src/lib/constants';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import TokenAbi from './abis/isolation-mode-factory.json';
import '../src/lib/env'
import {
  getAccountBalancesByMarket,
  getAmmLiquidityPositionAndEvents,
  getArbVestingLiquidityPositionAndEvents,
  getBalanceChangingEvents,
} from './lib/event-parser';
import { writeFileToGitHub } from './lib/file-helpers';
import {
  ARB_VESTER_PROXY,
  calculateFinalPoints,
  calculateVirtualLiquidityPoints,
  ETH_USDC_POOL,
  InterestOperation,
  LiquidityPositionsAndEvents,
  processEventsAndCalculateTotalRewardPoints,
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

const ezEthMarketId = 37;

async function start() {
  const networkId = await dolomite.web3.eth.net.getId();

  const validMarketIdsMap = {
    [ezEthMarketId]: new BigNumber(1).div(3600), // 1 point every hour (in seconds)
  }

  const blockStore = new BlockStore();
  await blockStore._update();
  const marketStore = new MarketStore(blockStore);

  const startTimestamp = 1713398400; // April 18 00:00:00
  const startBlockNumber = (await getLatestBlockNumberByTimestamp(startTimestamp)).blockNumber;
  const rawEndTimestamp = Math.floor(Date.now() / 1000);
  const {
    blockNumber: endBlockNumber,
    timestamp: endTimestamp,
  } = await getLatestBlockNumberByTimestamp(rawEndTimestamp);

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
    marketId: ezEthMarketId,
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

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(
    apiAccounts,
    startTimestamp,
    validMarketIdsMap,
  );

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);

  const totalPointsPerMarket: Record<number, Decimal> = processEventsAndCalculateTotalRewardPoints(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    validMarketIdsMap,
    endTimestamp,
    InterestOperation.NOTHING,
  );
  const allMarketIds = Object.keys(totalPointsPerMarket);
  allMarketIds.forEach(marketId => {
    if (marketId !== ezEthMarketId.toString()) {
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

  const poolToTotalSubLiquidityPoints = calculateVirtualLiquidityPoints(
    poolToVirtualLiquidityPositionsAndEvents,
    startTimestamp,
    endTimestamp,
  );

  const userToPointsMap = calculateFinalPoints(
    networkId,
    accountToDolomiteBalanceMap,
    validMarketIdsMap,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );
  const tokenAddress = await dolomite.getters.getMarketTokenAddress(new BigNumber(ezEthMarketId));
  const token = new dolomite.web3.eth.Contract(TokenAbi, tokenAddress);
  const tokenName = await dolomite.contracts.callConstantContractFunction(token.methods.name());

  const dataToWrite: OutputFile = {
    users: userToPointsMap,
    metadata: {
      marketId: ezEthMarketId,
      marketName: tokenName,
      totalPointsForMarket: totalPointsPerMarket[ezEthMarketId].times(ONE_ETH_WEI).toFixed(0),
      startBlock: startBlockNumber,
      endBlock: endBlockNumber,
      startTimestamp,
      endTimestamp,
    },
  };
  if (process.env.SCRIPTS !== 'true') {
    const filePath = `finalized/${networkId}/ez-eth/ez-eth-running-points.json`;
    await writeFileToGitHub(filePath, dataToWrite, true);
  } else {
    writeOutputFile(`${__dirname}/output/ez-points.json`, dataToWrite)
  }

  return true;
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
