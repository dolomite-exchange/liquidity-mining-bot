import { getLatestBlockNumberByTimestamp } from '../src/clients/blocks';
import './lib/env-reader';
import { MineralConfigFile, readFileFromGitHub, writeLargeFileToGitHub } from './lib/file-helpers';

export interface MineralConfig {

}

/**
 * path cannot start with a "/"
 */
const FILE_NAME_WITH_PATH = `scripts/config/mineral-season-0.json`;
const ONE_WEEK = 604_800;

export async function calculateMineralSeasonConfig(): Promise<number> {
  const outputFile = await readFileFromGitHub<MineralConfigFile>(FILE_NAME_WITH_PATH);
  const epochNumber: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  let maxKey = epochNumber
  if (isNaN(epochNumber)) {
    maxKey = Object.keys(outputFile.epochs).reduce((max, key) => {
      const value = parseInt(key, 10);
      if (value >= 900) {
        return max
      }
      return Math.max(max, parseInt(key, 10))
    }, 0);
  }

  const oldEpoch = outputFile.epochs[maxKey];

  const newEpoch = oldEpoch.isFinalized ? maxKey + 1 : maxKey;
  const newStartTimestamp = oldEpoch.isFinalized ? oldEpoch.endTimestamp : oldEpoch.startTimestamp;
  const newStartBlockNumber = oldEpoch.isFinalized ? oldEpoch.endBlockNumber : oldEpoch.startBlockNumber;
  const newEndTimestamp = newStartTimestamp + ONE_WEEK
  const blockResult = await getLatestBlockNumberByTimestamp(newEndTimestamp);
  const isFinalized = newEndTimestamp === blockResult.timestamp;

  await writeLargeFileToGitHub(
    FILE_NAME_WITH_PATH,
    {
      epochs: {
        ...outputFile.epochs,
        [newEpoch]: {
          epoch: newEpoch,
          startBlockNumber: newStartBlockNumber,
          startTimestamp: newStartTimestamp,
          endBlockNumber: blockResult.blockNumber,
          endTimestamp: blockResult.timestamp,
          isFinalized,
        },
      },
    },
    true,
  );

  return maxKey;
}

if (process.env.MINERALS_ENABLED !== 'true') {
  calculateMineralSeasonConfig()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error(`Found error while starting: ${error.toString()}`, error);
      process.exit(1);
    });
}
