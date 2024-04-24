import { isScript } from '../src/lib/env'
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import {
  ConfigFile,
  EpochConfig,
  getNextConfigIfNeeded,
  getOTokenConfigFileNameWithPath,
  OTokenType,
} from './lib/config-helper';
import { readFileFromGitHub, writeFileToGitHub } from './lib/file-helpers';

export const MAX_OARB_KEY_BEFORE_MIGRATIONS = 701;

interface OTokenConfigEpoch extends EpochConfig {
  oTokenAmount: string;
  rewardWeights: Record<string, string>;
}

export interface OTokenConfigFile extends ConfigFile<OTokenConfigEpoch> {
}

async function calculateOTokenSeasonConfig(
  skipConfigUpdate: boolean = false,
): Promise<number> {
  const { networkId } = dolomite;
  if (Number.isNaN(networkId)) {
    return Promise.reject(new Error('Invalid network ID'));
  }

  const oTokenConfigFile = await readFileFromGitHub<OTokenConfigFile>(getOTokenConfigFileNameWithPath(
    networkId,
    OTokenType.oARB,
  ));
  const selectedEpoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  let maxKey = selectedEpoch
  if (Number.isNaN(selectedEpoch)) {
    maxKey = Object.keys(oTokenConfigFile.epochs).reduce((max, key) => {
      const value = parseInt(key, 10);
      if (value >= MAX_OARB_KEY_BEFORE_MIGRATIONS) {
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
  await writeFileToGitHub(
    getOTokenConfigFileNameWithPath(
      configFile.metadata.networkId,
      OTokenType.oARB,
    ),
    configFile,
    true,
  );
}

if (isScript()) {
  calculateOTokenSeasonConfig()
    .then(() => {
      console.log('Finished executing script!');
      process.exit(0);
    })
    .catch(error => {
      console.error(`Found error while starting: ${error.toString()}`, error);
      process.exit(1);
    });
}
