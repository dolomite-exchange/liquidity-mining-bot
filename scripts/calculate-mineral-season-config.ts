import Logger from '../src/lib/logger';
import './lib/env-reader';
import { EpochConfig, getNextConfigIfNeeded } from './lib/config-helper';
import { readFileFromGitHub, writeLargeFileToGitHub } from './lib/file-helpers';

export interface MineralConfigEpoch extends EpochConfig {}

export interface MineralConfigFile {
  epochs: {
    [epoch: string]: MineralConfigEpoch
  };
}

/**
 * path cannot start with a "/"
 */
const FILE_NAME_WITH_PATH = `config/mineral-season-0.json`;

export async function calculateMineralSeasonConfig(skipConfigUpdate: boolean = false): Promise<number> {
  const configFile = await readFileFromGitHub<MineralConfigFile>(FILE_NAME_WITH_PATH);
  const epochNumber: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  let maxKey = epochNumber
  if (isNaN(epochNumber)) {
    maxKey = Object.keys(configFile.epochs).reduce((max, key) => {
      const value = parseInt(key, 10);
      if (value >= 900) {
        // 900+ is used for revisions and should be ignored
        return max
      }
      if (configFile.epochs[key].isTimeElapsed && configFile.epochs[key].isMerkleRootGenerated) {
        // Only go higher if the epoch has past and the merkle root is generated
        return Math.max(max, parseInt(key, 10));
      } else {
        return max;
      }
    }, 0);
  }

  if (skipConfigUpdate) {
    Logger.info({
      message: 'calculateMineralSeasonConfig: Skipping config update...',
      epochNumber: maxKey,
    });
    return maxKey;
  }

  const oldEpoch = configFile.epochs[maxKey];
  const nextEpochData = await getNextConfigIfNeeded(oldEpoch);

  const epochData: MineralConfigEpoch = {
    epoch: nextEpochData.isReadyForNext ? maxKey + 1 : maxKey,
    startBlockNumber: nextEpochData.newStartBlockNumber,
    startTimestamp: nextEpochData.newStartTimestamp,
    endBlockNumber: nextEpochData.actualEndBlockNumber,
    endTimestamp: nextEpochData.actualEndTimestamp,
    isTimeElapsed: nextEpochData.newEndTimestamp === nextEpochData.actualEndTimestamp,
    isMerkleRootGenerated: false,
    isMerkleRootWrittenOnChain: false
  };
  await writeMineralConfigToGitHub(configFile, epochData);

  return maxKey;
}

export async function writeMineralConfigToGitHub(
  configFile: MineralConfigFile,
  epochData: MineralConfigEpoch,
): Promise<void> {
  configFile.epochs[epochData.epoch] = epochData;
  await writeLargeFileToGitHub(
    FILE_NAME_WITH_PATH,
    configFile,
    true,
  );
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
