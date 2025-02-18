import { readOutputFile, writeOutputFile } from './lib/file-helpers';
import { dolomite } from '../src/helpers/web3';
import { chunkArray } from '../src/lib/utils';
import { getWeb3RequestWithBackoff } from './lib/web3-helper';
import Logger from '../src/lib/logger';
import v8 from 'v8';

const { networkId } = dolomite;
const FILE_NAME = `/airdrop-results/regular-airdrop-data-${networkId}-supply.json`;

async function getAllSmartContractUsersFromAirdrop() {
  Logger.info({
    message: 'Getting all smart contract users from airdrop...',
    dolomiteMargin: dolomite.address,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  const usersMap = JSON.parse(readOutputFile(FILE_NAME)!).users;
  const userChunks = chunkArray(Object.keys(usersMap), 120);
  Logger.info({
    message: 'Chunk data:',
    userChunks: userChunks.length,
    totalUsers: Object.keys(usersMap).length,
  });

  const smartContractUsers = {};
  for (let i = 0; i < userChunks.length; i += 1) {
    const userChunk = userChunks[i];
    const results = await getWeb3RequestWithBackoff(
      () => Promise.all(userChunk.map(user => dolomite.web3.eth.getCode(user))),
      1_100,
    );
    userChunk.forEach((user, j) => {
      if (results[j] !== '0x') {
        smartContractUsers[user] = true;
      }
    });

    if (i % 10 === 0) {
      Logger.info({
        message: `Finished getting chunk at ${i}`,
      });
    }
  }

  const result = {
    userCount: Object.keys(smartContractUsers).length,
    users: smartContractUsers,
  };
  writeOutputFile(`/airdrop-results/smart-contract-users-${networkId}.json`, result);
}

getAllSmartContractUsersFromAirdrop()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });
