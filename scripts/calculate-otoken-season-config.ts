import { isScript, shouldForceUpload } from '../src/lib/env'
import { dolomite } from '../src/helpers/web3';
import Logger from '../src/lib/logger';
import {
  getNextConfigIfNeeded,
  getOTokenConfigFileNameWithPath,
  getOTokenTypeFromEnvironment,
  getSeasonForOTokenType,
  writeOTokenConfigToGitHub,
} from './lib/config-helper';
import { readFileFromGitHub, writeOutputFile } from './lib/file-helpers';
import { OTokenConfigEpoch, OTokenConfigFile, OTokenType } from './lib/data-types';

export const MAX_OARB_KEY_BEFORE_MIGRATIONS = 701;

async function calculateOTokenSeasonConfig(
  oTokenType: OTokenType = getOTokenTypeFromEnvironment(),
  skipConfigUpdate: boolean = false,
): Promise<number> {
  const { networkId } = dolomite;
  if (Number.isNaN(networkId)) {
    return Promise.reject(new Error('Invalid network ID'));
  }

  const oTokenConfigFile = await readFileFromGitHub<OTokenConfigFile>(getOTokenConfigFileNameWithPath(
    networkId,
    oTokenType,
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

  if (!isScript() || shouldForceUpload()) {
    await writeOTokenConfigToGitHub(oTokenConfigFile, epochData);
  } else {
    Logger.info({
      message: 'Skipping config file upload due to script execution',
    });
    oTokenConfigFile.epochs[epochData.epoch] = epochData;
    const season = getSeasonForOTokenType(oTokenType);
    writeOutputFile(`${oTokenType}-${networkId}-season-${season}-output.json`, oTokenConfigFile);
  }

  return epochData.epoch;
}

if (isScript()) {
  calculateOTokenSeasonConfig(OTokenType.oARB)
    .then(() => {
      console.log('Finished executing script!');
      process.exit(0);
    })
    .catch(error => {
      console.error(`Found error while starting: ${error.toString()}`, error);
      process.exit(1);
    });
}
