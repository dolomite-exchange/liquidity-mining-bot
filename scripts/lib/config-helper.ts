import '../../src/lib/env';
import { getBlockDataByBlockNumber, getLatestBlockDataByTimestamp } from '../../src/clients/blocks';
import { writeFileToGitHub } from './file-helpers';
import {
  EpochConfig,
  MineralConfigEpoch,
  MineralConfigFile,
  MineralYtConfigEpoch,
  MineralYtConfigFile,
  NextConfig,
  OTokenType,
} from './data-types';

const ONE_WEEK_SECONDS = 86_400 * 7;

export async function getNextConfigIfNeeded<T extends EpochConfig>(oldEpoch: T): Promise<NextConfig> {
  const isReadyForNext = oldEpoch.isTimeElapsed && oldEpoch.isMerkleRootGenerated;
  const newStartBlockNumber = isReadyForNext ? oldEpoch.endBlockNumber : oldEpoch.startBlockNumber;
  const newStartTimestamp = isReadyForNext ? oldEpoch.endTimestamp : oldEpoch.startTimestamp;
  const newEndTimestamp = newStartTimestamp + ONE_WEEK_SECONDS;
  const newEndBlockNumberResult = await getLatestBlockDataByTimestamp(newEndTimestamp);

  // We need to check if `newEndBlockNumberResult` is the last block of the week
  const nextBlockData = await getBlockDataByBlockNumber(newEndBlockNumberResult.blockNumber + 1)

  // The week is over if the block is at the end OR if the next block goes into next week
  const isTimeElapsed = newEndTimestamp === newEndBlockNumberResult.timestamp
    || (!!nextBlockData && nextBlockData.timestamp > newEndTimestamp);

  return {
    isReadyForNext,
    newStartBlockNumber,
    newStartTimestamp,
    newEndTimestamp,
    actualEndBlockNumber: newEndBlockNumberResult.blockNumber,
    actualEndTimestamp: newEndBlockNumberResult.timestamp,
    isTimeElapsed,
  };
}

export const MINERAL_SEASON = 0;
export const OARB_SEASON = 0;
export const OMATIC_SEASON = 0;

/**
 * path cannot start with a "/"
 */
export function getMineralConfigFileNameWithPath(networkId: number): string {
  return getConfigFilePath(networkId, 'mineral', MINERAL_SEASON);
}

export function getMineralYtConfigFileNameWithPath(networkId: number): string {
  return getConfigFilePath(networkId, 'mineral', MINERAL_SEASON, '-yt');
}

/**
 * path cannot start with a "/"
 */
export function getOTokenConfigFileNameWithPath(networkId: number, oTokenType: OTokenType): string {
  return getConfigFilePath(networkId, oTokenType, getSeasonForOTokenType(oTokenType));
}

/**
 * path cannot start with a "/"
 */
export function getMineralMetadataFileNameWithPath(networkId: number): string {
  return getMetadataFilePath(networkId, 'mineral');
}

/**
 * path cannot start with a "/"
 */
export function getOTokenMetadataFileNameWithPath(networkId: number, oTokenType: OTokenType): string {
  return getMetadataFilePath(networkId, oTokenType);
}

/**
 * path cannot start with a "/"
 */
export function getMineralFinalizedFileNameWithPath(networkId: number, epoch: number): string {
  return getFinalizedFilePath(networkId, 'mineral', MINERAL_SEASON, epoch);
}

/**
 * path cannot start with a "/"
 */
export function getOTokenFinalizedFileNameWithPath(networkId: number, oTokenType: OTokenType, epoch: number): string {
  const season = getSeasonForOTokenType(oTokenType);
  return getFinalizedFilePath(networkId, oTokenType, season, epoch);
}

export function getOTokenTypeFromEnvironment(): OTokenType {
  const oTokenType = process.env.OTOKEN_TYPE;
  const oTokens = Object.values(OTokenType);
  if (!oTokenType || !oTokens.includes(oTokenType as any)) {
    throw new Error(`Invalid OTOKEN_TYPE, found: ${oTokenType}, expected one of ${oTokens}`);
  }
  return oTokenType as OTokenType;
}

function getSeasonForOTokenType(oTokenType: OTokenType): number {
  if (oTokenType === OTokenType.oARB) {
    return OARB_SEASON;
  } else if (oTokenType === OTokenType.oMATIC) {
    return OMATIC_SEASON;
  }

  throw new Error(`Invalid oTokenType, found ${oTokenType}`);
}

function getConfigFilePath(
  networkId: number,
  type: OTokenType | 'mineral',
  season: number,
  extra: string = '',
): string {
  return `config/${networkId}/${type}-season-${season}${extra}.json`
}

function getMetadataFilePath(networkId: number, type: OTokenType | 'mineral'): string {
  return `finalized/${networkId}/${type}/metadata.json`;
}

function getFinalizedFilePath(networkId: number, type: OTokenType | 'mineral', season: number, epoch: number): string {
  return `finalized/${networkId}/${type}/${type}-season-${season}-epoch-${epoch}-output.json`;
}

export async function writeMineralConfigToGitHub(
  configFile: MineralConfigFile,
  epochData: MineralConfigEpoch,
): Promise<void> {
  configFile.epochs[epochData.epoch] = epochData;
  await writeFileToGitHub(
    getMineralConfigFileNameWithPath(configFile.metadata.networkId),
    configFile,
    true,
  );
}

export async function writeMineralYtConfigToGitHub(
  configFile: MineralYtConfigFile,
  epochData: MineralYtConfigEpoch,
): Promise<void> {
  configFile.epochs[epochData.epoch] = epochData;
  await writeFileToGitHub(
    getMineralYtConfigFileNameWithPath(configFile.metadata.networkId),
    configFile,
    true,
  );
}
