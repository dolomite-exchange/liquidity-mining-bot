import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import fs from 'fs';
import v8 from 'v8';
import { getAllDolomiteAccountsWithToken, getTimestampToBlockNumberMap } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import BlockStore from '../src/lib/block-store';
import { ChainId } from '../src/lib/chain-id';
import { ONE_ETH_WEI } from '../src/lib/constants';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import TokenAbi from './abis/isolation-mode-factory.json';
import '../src/lib/env'
import { getMineralConfigFileNameWithPath } from './lib/config-helper';
import { MineralConfigFile } from './lib/data-types';
import {
  getAccountBalancesByMarket,
  getBalanceChangingEvents,
  getPoolAddressToVirtualLiquidityPositionsAndEvents,
} from './lib/event-parser';
import { readFileFromGitHub } from './lib/file-helpers';
import { setupRemapping } from './lib/remapper';
import {
  addToBlacklist,
  calculateFinalPoints,
  calculateVirtualLiquidityPoints,
  InterestOperation,
  processEventsUntilEndTimestamp,
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

const ONE_WEEK_SECONDS = 86_400 * 7;

const GRAI_MARKET_ID = 46;
const USDM_MARKET_ID = 48;

const CHAIN_TO_MARKET_ID_REWARDS_MAP: Record<ChainId, Record<string, Integer | undefined>> = {
  [ChainId.ArbitrumOne]: {
    [GRAI_MARKET_ID]: new BigNumber('9000').times(ONE_ETH_WEI),
    [USDM_MARKET_ID]: new BigNumber('1000').times(ONE_ETH_WEI),
  },
  [ChainId.Base]: {},
  [ChainId.Mantle]: {},
  [ChainId.PolygonZkEvm]: {},
  [ChainId.XLayer]: {},
};

const FOLDER_NAME = `${__dirname}/output`;

async function start() {
  const networkId = await dolomite.web3.eth.net.getId();

  const liquidityMiningConfig = await readFileFromGitHub<MineralConfigFile>(
    getMineralConfigFileNameWithPath(networkId),
  );

  const epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  let startTimestamp = parseInt(process.env.START_TIMESTAMP ?? 'NaN', 10);
  let endTimestamp = parseInt(process.env.END_TIMESTAMP ?? 'NaN', 10);
  if (Number.isNaN(epoch) && Number.isNaN(startTimestamp) && Number.isNaN(endTimestamp)) {
    return Promise.reject(new Error('Invalid EPOCH_NUMBER, START_TIMESTAMP, or END_TIMESTAMP'));
  } else if (!Number.isNaN(epoch) && !liquidityMiningConfig.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  } else if (!Number.isNaN(startTimestamp) && !Number.isNaN(endTimestamp)) {
    if (startTimestamp % ONE_WEEK_SECONDS !== 0 || endTimestamp % ONE_WEEK_SECONDS !== 0) {
      return Promise.reject(new Error('Invalid START_TIMESTAMP or END_TIMESTAMP modularity'));
    }
  }

  let startBlockNumber: number;
  let endBlockNumber: number;
  if (!Number.isNaN(epoch)) {
    startTimestamp = liquidityMiningConfig.epochs[epoch].startTimestamp;
    endTimestamp = liquidityMiningConfig.epochs[epoch].endTimestamp;
    startBlockNumber = liquidityMiningConfig.epochs[epoch].startBlockNumber;
    endBlockNumber = liquidityMiningConfig.epochs[epoch].endBlockNumber;
  } else {
    const timestampToBlockMap = await getTimestampToBlockNumberMap([startTimestamp, endTimestamp]);
    startBlockNumber = timestampToBlockMap[startTimestamp];
    endBlockNumber = timestampToBlockMap[endTimestamp];
  }

  const maxMarketId = (await dolomite.getters.getNumMarkets()).toNumber();
  const validMarketId = parseInt(process.env.MARKET_ID ?? 'NaN', 10);
  if (Number.isNaN(validMarketId)) {
    return Promise.reject(new Error(`Invalid MARKET_ID, found: ${process.env.MARKET_ID}`));
  } else if (validMarketId >= maxMarketId) {
    return Promise.reject(new Error(`MARKET_ID contains an element that is too large, found: ${validMarketId}`));
  }

  const validMarketIdMap = { [validMarketId]: INTEGERS.ONE };

  const blockStore = new BlockStore();
  await blockStore._update();
  const marketStore = new MarketStore(blockStore, true);

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

  const tokenAddress = await dolomite.getters.getMarketTokenAddress(new BigNumber(validMarketId));
  const token = new dolomite.web3.eth.Contract(TokenAbi, tokenAddress);
  const tokenName = await dolomite.contracts.callConstantContractFunction(token.methods.name());

  const goArbVesterProxy = ModuleDeployments.GravitaExternalVesterProxy[networkId];
  if (goArbVesterProxy) {
    addToBlacklist(goArbVesterProxy.address);
  }
  if (validMarketId === GRAI_MARKET_ID) {
    addToBlacklist('0xfB0214D7Ac08ed0D2D9cA920EA6D4f4be2654EA5'); // Gravita multisig
  }

  const apiAccounts = await Pageable.getPageableValues(async (lastId) => {
    const result = await getAllDolomiteAccountsWithToken(tokenAddress, startMarketIndexMap, startBlockNumber, lastId);
    return result.accounts;
  });

  await setupRemapping(networkId, endBlockNumber);

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(
    apiAccounts,
    startTimestamp,
    validMarketIdMap,
  );

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber, tokenAddress);

  processEventsUntilEndTimestamp(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    validMarketIdMap,
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

  const { userToPointsMap, marketToPointsMap } = calculateFinalPoints(
    networkId,
    accountToDolomiteBalanceMap,
    validMarketIdMap,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );

  const allMarketIds = Object.keys(marketToPointsMap);
  allMarketIds.forEach(marketId => {
    if (marketId !== validMarketId.toString()) {
      delete marketToPointsMap[marketId];
    }
  });

  const rewardToSplit = CHAIN_TO_MARKET_ID_REWARDS_MAP[networkId as ChainId][validMarketId];
  const fileName = `${FOLDER_NAME}/asset-held-${startTimestamp}-${endTimestamp}-${validMarketId}-output.json`;
  const dataToWrite = readOutputFile(fileName);
  dataToWrite.users = Object.keys(userToPointsMap).reduce((memo, user) => {
    const points = userToPointsMap[user];
    if (rewardToSplit) {
      memo[user] = rewardToSplit.times(points).dividedToIntegerBy(marketToPointsMap[validMarketId]).toFixed(0);
    } else {
      memo[user] = points.toFixed(0);
    }
    return memo;
  }, {});
  dataToWrite.metadata = {
    marketId: validMarketId,
    marketName: tokenName,
    totalPointsForMarket: (rewardToSplit ?? marketToPointsMap[validMarketId]).toFixed(0),
    startBlock: startBlockNumber,
    endBlock: endBlockNumber,
    startTimestamp,
    endTimestamp,
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

  const amountsAsCsv = Object.keys(fileContent.users).map(user => {
    const userAmount = new BigNumber(fileContent.users[user]).div(ONE_ETH_WEI).toFixed(18);
    return `${user.toLowerCase()},${userAmount}`;
  });
  fs.writeFileSync(
    fileName.replace('.json', '.csv'),
    amountsAsCsv.join('\n'),
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
