import { dolomite } from '../src/helpers/web3';
import { isScript } from '../src/lib/env';
import Logger from '../src/lib/logger';
import {
  getMineralConfigFileNameWithPath,
  getMineralYtConfigFileNameWithPath,
  getNextConfigIfNeeded,
  MINERAL_SEASON,
  writeMineralConfigToGitHub,
  writeMineralYtConfigToGitHub,
} from './lib/config-helper';
import { readFileFromGitHub, writeOutputFile } from './lib/file-helpers';
import { MineralConfigEpoch, MineralConfigFile, MineralYtConfigEpoch, MineralYtConfigFile } from './lib/data-types';

export const MIN_MINERALS_KEY_BEFORE_MIGRATIONS = 900
export const MAX_MINERALS_KEY_BEFORE_MIGRATIONS = 10_000;

export enum MineralConfigType {
  RegularConfig = 0,
  YtConfig = 1,
}

type ConfigType<T extends MineralConfigType> =
  T extends MineralConfigType.RegularConfig ? MineralConfigFile
    : T extends MineralConfigType.YtConfig ? MineralYtConfigFile
      : never;

type EpochConfigType<T extends MineralConfigType> =
  T extends MineralConfigType.RegularConfig ? MineralConfigEpoch
    : T extends MineralConfigType.YtConfig ? MineralYtConfigEpoch
      : never;

export async function calculateMineralSeasonConfig<T extends MineralConfigType>(
  configType: T,
  options: { skipConfigUpdate: boolean } = { skipConfigUpdate: false },
): Promise<{ epochNumber: number; endTimestamp: number; isEpochElapsed: boolean }> {
  const networkId = await dolomite.web3.eth.net.getId();

  const mineralConfigPath = configType === MineralConfigType.RegularConfig
    ? getMineralConfigFileNameWithPath(networkId)
    : configType === MineralConfigType.YtConfig
      ? getMineralYtConfigFileNameWithPath(networkId)
      : undefined;
  if (!mineralConfigPath) {
    return Promise.reject(new Error(`Invalid config type, found ${configType}`));
  }

  const configFile = await readFileFromGitHub<ConfigType<T>>(mineralConfigPath);
  const epochNumber: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  let maxKey = epochNumber
  if (Number.isNaN(epochNumber)) {
    maxKey = Object.keys(configFile.epochs).reduce((max, key) => {
      const value = parseInt(key, 10);
      if (
        Number.isNaN(value)
        || (value >= MIN_MINERALS_KEY_BEFORE_MIGRATIONS && value <= MAX_MINERALS_KEY_BEFORE_MIGRATIONS)
      ) {
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

  if (options.skipConfigUpdate) {
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

  let epochData: EpochConfigType<T>;
  if (configType === MineralConfigType.RegularConfig) {
    const typedConfigFile = configFile as MineralConfigFile;
    epochData = (
      {
        epoch: nextEpochData.isReadyForNext ? maxKey + 1 : maxKey,
        startBlockNumber: nextEpochData.newStartBlockNumber,
        startTimestamp: nextEpochData.newStartTimestamp,
        endBlockNumber: nextEpochData.actualEndBlockNumber,
        endTimestamp: nextEpochData.actualEndTimestamp,
        isTimeElapsed: nextEpochData.isTimeElapsed,
        isMerkleRootGenerated: false,
        isMerkleRootWrittenOnChain: false,
        boostedMultiplier: (typedConfigFile.epochs[maxKey + 1] ?? oldEpoch).boostedMultiplier,
        marketIdToRewardMap: (typedConfigFile.epochs[maxKey + 1] ?? oldEpoch).marketIdToRewardMap,
      } as MineralConfigEpoch
    ) as EpochConfigType<T>;
  } else if (configType === MineralConfigType.YtConfig) {
    const typedConfigFile = configFile as MineralYtConfigFile;
    epochData = (
      {
        epoch: nextEpochData.isReadyForNext ? maxKey + 1 : maxKey,
        startBlockNumber: nextEpochData.newStartBlockNumber,
        startTimestamp: nextEpochData.newStartTimestamp,
        endBlockNumber: nextEpochData.actualEndBlockNumber,
        endTimestamp: nextEpochData.actualEndTimestamp,
        isTimeElapsed: nextEpochData.isTimeElapsed,
        isMerkleRootGenerated: false,
        isMerkleRootWrittenOnChain: false,
        boostedMultiplier: (typedConfigFile.epochs[maxKey + 1] ?? oldEpoch).boostedMultiplier,
        marketId: (typedConfigFile.epochs[maxKey + 1] ?? oldEpoch).marketId,
        marketIdReward: (typedConfigFile.epochs[maxKey + 1] ?? oldEpoch).marketIdReward,
      } as MineralYtConfigEpoch
    ) as EpochConfigType<T>;
  } else {
    return Promise.reject(new Error(`Invalid config type, found ${configType}`));
  }

  if (!isScript()) {
    if (configType === MineralConfigType.RegularConfig) {
      await writeMineralConfigToGitHub(configFile as MineralConfigFile, epochData as MineralConfigEpoch);
    } else if (configType === MineralConfigType.YtConfig) {
      await writeMineralYtConfigToGitHub(configFile as MineralYtConfigFile, epochData as MineralYtConfigEpoch);
    } else {
      return Promise.reject(new Error(`Invalid config type, found ${configType}`));
    }
  } else {
    const data = {
      ...configFile,
      epochs: {
        ...configFile.epochs,
        [epochData.epoch]: epochData,
      },
    }
    const extraData = configType === MineralConfigType.RegularConfig
      ? ''
      : configType === MineralConfigType.YtConfig
        ? '-yt'
        : undefined;
    if (extraData === undefined) {
      return Promise.reject(new Error(`Invalid config type, found ${configType}`));
    }

    writeOutputFile(
      `mineral-${networkId}-season-${MINERAL_SEASON}-epoch-${epochData.epoch}${extraData}-config.json`,
      data,
      2,
    );
  }

  Logger.info({
    at: 'calculateMineralSeasonConfig',
    epochNumber: epochData.epoch,
    endTimestamp: epochData.endTimestamp,
    isEpochElapsed: epochData.isTimeElapsed,
  });

  return {
    epochNumber: epochData.epoch,
    endTimestamp: epochData.endTimestamp,
    isEpochElapsed: epochData.isTimeElapsed,
  };
}

if (isScript()) {
  calculateMineralSeasonConfig(MineralConfigType.YtConfig)
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error(`Found error while starting: ${error.toString()}`, error);
      process.exit(1);
    });
}
