import './lib/env-reader';
import { MineralConfigEpoch, MineralConfigFile } from './calculate-mineral-season-config';
import { EpochConfig, getNextConfigIfNeeded } from './lib/config-helper';
import { readFileFromGitHub, writeLargeFileToGitHub } from './lib/file-helpers';

interface OTokenEpochConfig extends EpochConfig {
  oTokenAmount: string;
  rewardWeights: Record<string, string>;
}

export interface OTokenConfigFile {
  epochs: {
    [epoch: string]: OTokenEpochConfig
  };
}

/**
 * path cannot start with a "/"
 */
const FILE_NAME_WITH_PATH = `config/oarb-season-0.json`;

async function start() {
  const oTokenConfigFile = await readFileFromGitHub<OTokenConfigFile>(FILE_NAME_WITH_PATH);
  const selectedEpoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  let maxKey = selectedEpoch
  if (isNaN(selectedEpoch)) {
    maxKey = Object.keys(oTokenConfigFile.epochs).reduce((max, key) => {
      const value = parseInt(key, 10);
      if (value >= 900) {
        return max
      }
      return Math.max(max, parseInt(key, 10))
    }, 0);
  }

  const oldEpoch = oTokenConfigFile.epochs[maxKey];
  const nextEpochData = await getNextConfigIfNeeded(oldEpoch);

  const epochData: OTokenEpochConfig = {
    epoch: nextEpochData.isReadyForNext ? maxKey + 1 : maxKey,
    startBlockNumber: nextEpochData.newStartBlockNumber,
    startTimestamp: nextEpochData.newStartTimestamp,
    endBlockNumber: nextEpochData.actualEndBlockNumber,
    endTimestamp: nextEpochData.actualEndTimestamp,
    isTimeElapsed: nextEpochData.newEndTimestamp === nextEpochData.actualEndTimestamp,
    oTokenAmount: oldEpoch.oTokenAmount,
    rewardWeights: oldEpoch.rewardWeights,
    isMerkleRootGenerated: false,
    isMerkleRootWrittenOnChain: false
  };

  await writeMineralConfigToGitHub(oTokenConfigFile, epochData);

  return true;
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


start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
