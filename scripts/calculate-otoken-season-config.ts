import './lib/env-reader';
import Logger from '../src/lib/logger';
import {
  ConfigFile,
  EpochConfig,
  getNextConfigIfNeeded,
  getOTokenConfigFileNameWithPath,
  OTokenType,
} from './lib/config-helper';
import { readFileFromGitHub, writeLargeFileToGitHub } from './lib/file-helpers';

interface OTokenConfigEpoch extends EpochConfig {
  oTokenAmount: string;
  rewardWeights: Record<string, string>;
}

export interface OTokenConfigFile extends ConfigFile<OTokenConfigEpoch> {
}

async function calculateOTokenSeasonConfig(
  skipConfigUpdate: boolean = false,
  networkId: number = parseInt(process.env.NETWORK_ID),
): Promise<number> {
  if (Number.isNaN(networkId)) {
    return Promise.reject(new Error('Invalid network ID'));
  }

  const oTokenConfigFile = await readFileFromGitHub<OTokenConfigFile>(getOTokenConfigFileNameWithPath(
    networkId,
    OTokenType.oARB,
  ));
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

  if (skipConfigUpdate) {
    Logger.info({
      message: 'calculateOTokenSeasonConfig: Skipping config update...',
      epochNumber: maxKey,
    });
    return maxKey;
  }

  const oldEpoch = oTokenConfigFile.epochs[maxKey];
  const nextEpochData = await getNextConfigIfNeeded(oldEpoch);

  const epochData: OTokenConfigEpoch = {
    epoch: nextEpochData.isReadyForNext ? maxKey + 1 : maxKey,
    startBlockNumber: nextEpochData.newStartBlockNumber,
    startTimestamp: nextEpochData.newStartTimestamp,
    endBlockNumber: nextEpochData.actualEndBlockNumber,
    endTimestamp: nextEpochData.actualEndTimestamp,
    isTimeElapsed: nextEpochData.newEndTimestamp === nextEpochData.actualEndTimestamp,
    oTokenAmount: oldEpoch.oTokenAmount,
    rewardWeights: oldEpoch.rewardWeights,
    isMerkleRootGenerated: false,
    isMerkleRootWrittenOnChain: false,
  };

  await writeOTokenConfigToGitHub(oTokenConfigFile, epochData);

  return epochData.epoch;
}

export async function writeOTokenConfigToGitHub(
  configFile: OTokenConfigFile,
  epochData: OTokenConfigEpoch,
): Promise<void> {
  configFile.epochs[epochData.epoch] = epochData;
  await writeLargeFileToGitHub(
    getOTokenConfigFileNameWithPath(
      configFile.metadata.networkId,
      OTokenType.oARB,
    ),
    configFile,
    true,
  );
}


calculateOTokenSeasonConfig()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
