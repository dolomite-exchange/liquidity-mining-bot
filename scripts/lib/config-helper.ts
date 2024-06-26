import '../../src/lib/env';
import { getBlockDataByBlockNumber, getLatestBlockDataByTimestamp } from '../../src/clients/blocks';
import { writeFileToGitHub } from './file-helpers';

export interface UserMineralAllocationForFile {
  amount: string; // big int
  multiplier: string; // decimal
  proofs: string[];
}

export interface UserYtMineralAllocationForFile {
  amount: string; // big int
  proofs: string[];
}

export interface MineralYtOutputFile {
  users: {
    [walletAddressLowercase: string]: UserYtMineralAllocationForFile;
  };
  metadata: {
    epoch: number;
    merkleRoot: string | null;
    marketId: number;
    totalAmount: string; // big int
    totalUsers: number; // big int
    startBlockNumber: number;
    endBlockNumber: number;
    startTimestamp: number;
    endTimestamp: number;
    boostedMultiplier: string; // decimal
  };
}

export interface MineralOutputFile {
  users: {
    [walletAddressLowercase: string]: UserMineralAllocationForFile;
  };
  metadata: {
    epoch: number;
    merkleRoot: string | null;
    marketIds: number[];
    marketNames: string[];
    totalAmount: string; // big int
    totalUsers: number; // big int
    startBlockNumber: number;
    endBlockNumber: number;
    startTimestamp: number;
    endTimestamp: number;
    boostedMultiplier: string | null | undefined;
  };
}

export interface MineralConfigEpoch extends EpochConfig {
  marketIdToRewardMap: {
    [marketId: string]: string;
  };
  boostedMultiplier: string | undefined | null; // decimal
}

export interface MineralYtConfigEpoch extends EpochConfig {
  boostedMultiplier: string; // decimal
  marketId: number;
}

export interface MineralConfigFile extends ConfigFile<MineralConfigEpoch> {
}

export interface MineralYtConfigFile extends ConfigFile<MineralYtConfigEpoch> {
}

export enum OTokenType {
  oARB = 'oarb',
  oMATIC = 'omatic',
}

export interface EpochConfig {
  epoch: number;
  startTimestamp: number;
  endTimestamp: number;
  startBlockNumber: number;
  endBlockNumber: number;
  isTimeElapsed: boolean;
  isMerkleRootGenerated: boolean;
  isMerkleRootWrittenOnChain: boolean;
}

export interface ConfigFile<T> {
  epochs: {
    [epoch: string]: T
  };
  metadata: {
    networkId: number;
  };
}

export interface EpochMetadata {
  maxEpochNumber: number;
}

interface NextConfig {
  /**
   * True if the old epoch has elapsed and the merkle root was generated
   */
  isReadyForNext: boolean;
  /**
   * The block number that marks the start of the epoch
   */
  newStartBlockNumber: number;
  /**
   * Timestamp that marks the start of the epoch
   */
  newStartTimestamp: number;
  /**
   * Always one week after the start timestamp
   */
  newEndTimestamp: number;
  /**
   * The latest seen block number. Not necessarily be ONE WEEK after the start block
   */
  actualEndBlockNumber: number;
  /**
   * The latest seen block timestamp. Not necessarily be ONE WEEK after the start timestamp
   */
  actualEndTimestamp: number;
  /**
   * True if the week is over and the next block occurs in the next week
   */
  isTimeElapsed: boolean;
}

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

function getConfigFilePath(networkId: number, type: OTokenType | 'mineral', season: number, extra: string = ''): string {
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
