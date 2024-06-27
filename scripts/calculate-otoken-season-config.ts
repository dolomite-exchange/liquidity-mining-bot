import { isScript } from '../src/lib/env'
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import {
  getNextConfigIfNeeded,
  getOTokenConfigFileNameWithPath,
  writeOTokenConfigToGitHub,
} from './lib/config-helper';
import { readFileFromGitHub } from './lib/file-helpers';
import { OTokenConfigEpoch, OTokenConfigFile, OTokenType } from './lib/data-types';

export const MAX_OARB_KEY_BEFORE_MIGRATIONS = 701;

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
    isTimeElapsed: nextEpochData.isTimeElapsed,
    oTokenAmount: oldEpoch.oTokenAmount,
    rewardWeights: oldEpoch.rewardWeights,
    isMerkleRootGenerated: false,
    isMerkleRootWrittenOnChain: false,
  };

  await writeOTokenConfigToGitHub(oTokenConfigFile, epochData);

  return epochData.epoch;
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
