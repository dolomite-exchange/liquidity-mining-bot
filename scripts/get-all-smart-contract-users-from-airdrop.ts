import { readOutputFile, writeOutputFile } from './lib/file-helpers';
import { dolomite } from '../src/helpers/web3';
import { chunkArray } from '../src/lib/utils';

const { networkId } = dolomite;
const FILE_NAME = `/airdrop-results/regular-airdrop-data-${networkId}-supplies.json`;

async function getAllSmartContractUsersFromAirdrop() {
  const usersMap = JSON.parse(readOutputFile(FILE_NAME)!).users;
  const userChunks = chunkArray(Object.keys(usersMap), 100);
  const smartContractUsers = {};
  for (let i = 0; i < userChunks.length; i += 1) {
    const userChunk = userChunks[i];
    const results = await Promise.all(userChunk.map(user => dolomite.web3.eth.getCode(user)));
    userChunk.forEach((user, j) => {
      if (results[j] !== '0x') {
        smartContractUsers[user] = true;
      }
    });
  }

  writeOutputFile(`/airdrop-results/smart-contract-users-${networkId}.json`, { users: smartContractUsers });
}

getAllSmartContractUsersFromAirdrop()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });
