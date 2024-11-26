import { INTEGERS } from '@dolomite-exchange/dolomite-margin';
import fs from 'fs';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue, getTimestampToBlockNumberMap } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { isScript } from '../src/lib/env';
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import BlockStore from '../src/lib/stores/block-store';
import MarketStore from '../src/lib/stores/market-store';
import '../src/lib/env'
import { getAccountBalancesByMarket, getBalanceChangingEvents } from './lib/event-parser';
import { setupRemapping } from './lib/remapper';
import { calculateFinalPoints, InterestOperation, processEventsUntilEndTimestamp } from './lib/rewards';

/* eslint-enable */

const FOLDER_NAME = `${__dirname}/output`;

export async function getAllBerachainTestnetUsers() {
  const { networkId } = dolomite;

  const startTimestamp = 1721520000; // July 21, 2024, @ 00:00:00
  const endTimestamp = 1732579200; // November 26, 2024 @ 00:00:00

  const timestampToBlockMap = await getTimestampToBlockNumberMap([startTimestamp, endTimestamp]);
  const startBlockNumber = timestampToBlockMap[startTimestamp];
  const endBlockNumber = timestampToBlockMap[endTimestamp];

  const blockStore = new BlockStore();
  await blockStore._update();
  const marketStore = new MarketStore(blockStore, true);

  Logger.info({
    message: 'DolomiteMargin data',
    blockRewardStart: startBlockNumber,
    blockRewardStartTimestamp: startTimestamp,
    blockRewardEnd: endBlockNumber,
    blockRewardEndTimestamp: endTimestamp,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  const marketCount = await dolomite.getters.getNumMarkets();
  const validMarketIdMap = {};
  for (let i = 0; i < marketCount.toNumber(); i++) {
    validMarketIdMap[i] = INTEGERS.ONE;
  }

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

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(
    apiAccounts,
    startTimestamp,
    validMarketIdMap,
  );

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);

  processEventsUntilEndTimestamp(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    validMarketIdMap,
    endTimestamp,
    InterestOperation.NOTHING,
  );

  const { userToPointsMap } = calculateFinalPoints(
    networkId,
    accountToDolomiteBalanceMap,
    validMarketIdMap,
    {},
    {},
  );

  const fileName = `${FOLDER_NAME}/berachain-testnet-users.csv`;
  const allUsers = Object.keys(userToPointsMap).reduce((memo, user, _, list) => {
    memo[user] = INTEGERS.ONE.div(list.length).toFixed(18);
    return memo;
  }, {} as Record<string, string>);
  writeOutputFile(fileName, allUsers);

  return true;
}

function writeOutputFile(
  fileName: string,
  allUsers: Record<string, string>,
): void {
  if (!fs.existsSync(FOLDER_NAME)) {
    fs.mkdirSync(FOLDER_NAME);
  }

  const content = Object.keys(allUsers).reduce((memo, key) => {
    memo += `${key},${allUsers[key]}\n`;
    return memo;
  }, '');
  fs.writeFileSync(
    fileName,
    content,
    { encoding: 'utf8', flag: 'w' },
  );
}

if (isScript()) {
  getAllBerachainTestnetUsers()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while starting:', error);
      process.exit(1);
    });
}
