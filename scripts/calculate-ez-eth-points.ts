import { BigNumber, Decimal, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import fs from 'fs';
import v8 from 'v8';
import { getLatestBlockNumberByTimestamp } from '../src/clients/blocks';
import { getAllDolomiteAccountsWithToken } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { MarketIndex } from '../src/lib/api-types';
import { ONE_ETH_WEI } from '../src/lib/constants';
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import TokenAbi from './abis/isolation-mode-factory.json';
import '../src/lib/env'
import { getAccountBalancesByMarket, getBalanceChangingEvents } from './lib/event-parser';
import { readFileFromGitHub, writeFileToGitHub } from './lib/file-helpers';
import { calculateFinalPoints, InterestOperation, processEventsAndCalculateTotalRewardPoints } from './lib/rewards';

/* eslint-enable */

interface OutputFile {
  users: {
    [walletAddressLowercase: string]: string // big int
  };
  metadata: {
    marketId: number
    marketName: string // big int
    ezPoints: string // big int
    startBlock: number
    endBlock: number
    startTimestamp: number
    endTimestamp: number
  };
}

const FOLDER_NAME = `${__dirname}/output`;

const ezEthMarketId = 37;

export async function calculateEzEthPoints(appendResults: boolean) {
  if (appendResults) {
    Logger.info({
      message: 'Using append strategy...',
    });
  } else {
    Logger.info({
      message: 'Performing raw pull for data...',
    });
  }

  const networkId = await dolomite.web3.eth.net.getId();
  const githubFilePath = `finalized/${networkId}/ez-eth/ez-eth-running-points.json`;
  const oldData = await readFileFromGitHub<OutputFile>(githubFilePath);

  const validMarketIdsMap = {
    [ezEthMarketId]: new BigNumber(1).div(3600), // 1 point every hour (in seconds)
  }

  const realStartTimestamp = 1713398400; // April 18 00:00:00
  const realStartBlock = 202117429;

  const startTimestamp = appendResults ? oldData.metadata.endTimestamp : realStartTimestamp;
  const startBlockNumber = appendResults ? oldData.metadata.endBlock : realStartBlock;
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

  const marketIndexMap: Record<string, MarketIndex> = {
    [ezEthMarketId]: {
      marketId: ezEthMarketId,
      supply: INTEGERS.ONE,
      borrow: INTEGERS.ONE,
    },
  }
  const tokenAddress = await dolomite.getters.getMarketTokenAddress(new BigNumber(ezEthMarketId));

  const apiAccounts = await Pageable.getPageableValues(async (lastId) => {
    const result = await getAllDolomiteAccountsWithToken(tokenAddress, marketIndexMap, startBlockNumber, lastId);
    return result.accounts;
  });

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(
    apiAccounts,
    startTimestamp,
    validMarketIdsMap,
  );

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber, tokenAddress);

  const totalPointsPerMarket: Record<number, Decimal> = processEventsAndCalculateTotalRewardPoints(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    marketIndexMap,
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

  const EMPTY_MAP = {};
  const userToPointsMap = calculateFinalPoints(
    networkId,
    accountToDolomiteBalanceMap,
    validMarketIdsMap,
    EMPTY_MAP,
    EMPTY_MAP,
    appendResults ? oldData.users : undefined,
  );
  const token = new dolomite.web3.eth.Contract(TokenAbi, tokenAddress);
  const tokenName = await dolomite.contracts.callConstantContractFunction(token.methods.name());
  const totalEzPoints = totalPointsPerMarket[ezEthMarketId]
    .times(ONE_ETH_WEI)
    .plus(oldData.metadata.ezPoints ?? '0');

  const dataToWrite: OutputFile = {
    users: userToPointsMap,
    metadata: {
      marketId: ezEthMarketId,
      marketName: tokenName,
      ezPoints: totalEzPoints.toFixed(0),
      startTimestamp: realStartTimestamp,
      endTimestamp,
      startBlock: realStartBlock,
      endBlock: endBlockNumber,
    },
  };
  if (process.env.SCRIPT === 'true') {
    await writeFileToGitHub(githubFilePath, dataToWrite, true);
  } else {
    const fileName = `${__dirname}/output/ez-points.json`;
    console.log('Writing ez points to file', fileName);
    writeOutputFile(fileName, dataToWrite)
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

if (process.env.SCRIPT === 'true') {
  calculateEzEthPoints(false)
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while starting:', error);
      process.exit(1);
    });
}
