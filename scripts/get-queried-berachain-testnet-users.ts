import { INTEGERS } from '@dolomite-exchange/dolomite-margin';
import fs from 'fs';
import v8 from 'v8';
import { getAllUsersWithAtLeastBorrowPositions, getTimestampToBlockNumberMap } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { isScript } from '../src/lib/env';
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import BlockStore from '../src/lib/stores/block-store';
import '../src/lib/env'

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

  const apiUsers = await Pageable.getPageableValues(async (lastId) => {
    const result = await getAllUsersWithAtLeastBorrowPositions(2, endBlockNumber, lastId);
    return result.users;
  });

  const fileName = `${FOLDER_NAME}/berachain-queried-testnet-users.csv`;
  const allUsers = apiUsers.reduce((memo, user, _, list) => {
    memo[user.id] = INTEGERS.ONE.div(list.length).toFixed(18);
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
