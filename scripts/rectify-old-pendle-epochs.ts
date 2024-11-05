import '../src/lib/env'
import { dolomite } from '../src/helpers/web3';
import { getMineralConfigFileNameWithPath, getMineralFinalizedFileNameWithPath } from './lib/config-helper';
import { MineralConfigFile, MineralPendleOutputFile } from './lib/data-types';
import { readFileFromGitHub, writeFileToGitHub } from './lib/file-helpers';

async function start() {
  for (let i = 10_008; i <= 10_023; i++) {
    const fileName = getMineralFinalizedFileNameWithPath(dolomite.networkId, i);
    const oldMineralFile = await readFileFromGitHub<MineralPendleOutputFile>(fileName);
    Object.keys(oldMineralFile.users).forEach(user => {
      oldMineralFile.users[user] = {
        ...oldMineralFile.users[user],
        marketIdToAmountMap: {
          '17': oldMineralFile.users[user].amount,
        },
      };
    });
    await writeFileToGitHub(fileName, oldMineralFile, false);
  }

  const configFile = await readFileFromGitHub<MineralConfigFile>(getMineralConfigFileNameWithPath(dolomite.networkId));
  const missingEpochs = [10_024, 10_025, 10_026];
  for (let missingEpoch of missingEpochs) {
    const epochData = configFile.epochs[missingEpoch - 10_000];
    const content = {
      users: {},
      metadata: {
        epoch: missingEpoch,
        merkleRoot: null,
        startTimestamp: epochData.startTimestamp,
        syncTimestamp: epochData.startTimestamp,
        endTimestamp: epochData.endTimestamp,
        startBlockNumber: epochData.startBlockNumber,
        syncBlockNumber: epochData.startBlockNumber,
        endBlockNumber: epochData.endBlockNumber,
        boostedMultiplier: 3,
        totalAmount: '0',
        totalUsers: 0,
        marketIdToRewardMap: {},
      },
    };
    await writeFileToGitHub(getMineralFinalizedFileNameWithPath(dolomite.networkId, missingEpoch), content, false)
  }
}

start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
