import { dolomite } from '../src/helpers/web3';
import { isScript } from '../src/lib/env';
import Logger from '../src/lib/logger';
import {
  getMineralConfigFileNameWithPath,
  getNextConfigIfNeeded,
  MineralConfigEpoch,
  MineralConfigFile,
  writeMineralConfigToGitHub,
} from './lib/config-helper';
import { readFileFromGitHub } from './lib/file-helpers';

export const MAX_MINERALS_KEY_BEFORE_MIGRATIONS = 900

export async function calculateMineralSeasonConfig(
  skipConfigUpdate: boolean = false,
): Promise<{ epochNumber: number; endTimestamp: number; isEpochElapsed: boolean }> {
  const networkId = await dolomite.web3.eth.net.getId();

  const configFile = await readFileFromGitHub<MineralConfigFile>(getMineralConfigFileNameWithPath(networkId));
  const epochNumber: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  let maxKey = epochNumber
  if (Number.isNaN(epochNumber)) {
    maxKey = Object.keys(configFile.epochs).reduce((max, key) => {
      const value = parseInt(key, 10);
      if (Number.isNaN(value) || value >= MAX_MINERALS_KEY_BEFORE_MIGRATIONS) {
        return max
      }
      if (configFile.epochs[value].isTimeElapsed && configFile.epochs[value].isMerkleRootGenerated) {
        // Only go higher if the epoch has past and the merkle root is generated
        return Math.max(max, value);
      } else {
        return max;
      }
    }, 0);
  }

  if (skipConfigUpdate) {
    Logger.info({
      at: 'calculateMineralSeasonConfig',
      message: 'Skipping config update...',
      maxFinalizedEpochNumber: maxKey,
    });
    return {
      epochNumber: maxKey,
      endTimestamp: configFile.epochs[maxKey].endTimestamp,
      isEpochElapsed: configFile.epochs[maxKey].isTimeElapsed,
    };
  }

  const oldEpoch = configFile.epochs[maxKey];
  const nextEpochData = await getNextConfigIfNeeded(oldEpoch);

  const isTimeElapsed = nextEpochData.newEndTimestamp === nextEpochData.actualEndTimestamp;

  const epochData: MineralConfigEpoch = {
    epoch: nextEpochData.isReadyForNext ? maxKey + 1 : maxKey,
    startBlockNumber: nextEpochData.newStartBlockNumber,
    startTimestamp: nextEpochData.newStartTimestamp,
    endBlockNumber: nextEpochData.actualEndBlockNumber,
    endTimestamp: nextEpochData.actualEndTimestamp,
    isTimeElapsed,
    isMerkleRootGenerated: false,
    isMerkleRootWrittenOnChain: false,
    marketIdToRewardMap: oldEpoch.marketIdToRewardMap,
  };
  await writeMineralConfigToGitHub(configFile, epochData);

  Logger.info({
    at: 'calculateMineralSeasonConfig',
    epochNumber: epochData.epoch,
    endTimestamp: epochData.endTimestamp,
    isEpochElapsed: epochData.isTimeElapsed,
  });

  return { epochNumber: epochData.epoch, endTimestamp: epochData.endTimestamp, isEpochElapsed: isTimeElapsed };
}

if (isScript()) {
  calculateMineralSeasonConfig()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error(`Found error while starting: ${error.toString()}`, error);
      process.exit(1);
    });
}
