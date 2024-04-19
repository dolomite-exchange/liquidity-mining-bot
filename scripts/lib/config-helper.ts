import { getLatestBlockNumberByTimestamp } from '../../src/clients/blocks';

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
}

const ONE_WEEK = 86_400 * 7;

export async function getNextConfigIfNeeded(oldEpoch: EpochConfig): Promise<NextConfig> {
  const isReadyForNext = oldEpoch.isTimeElapsed && oldEpoch.isMerkleRootGenerated;
  const newStartBlockNumber = isReadyForNext ? oldEpoch.endBlockNumber : oldEpoch.startBlockNumber;
  const newStartTimestamp = isReadyForNext ? oldEpoch.endTimestamp : oldEpoch.startTimestamp;
  const newEndTimestamp = newStartTimestamp + ONE_WEEK
  const newEndBlockNumberResult = await getLatestBlockNumberByTimestamp(newEndTimestamp);

  return {
    isReadyForNext,
    newStartBlockNumber,
    newStartTimestamp,
    newEndTimestamp,
    actualEndBlockNumber: newEndBlockNumberResult.blockNumber,
    actualEndTimestamp: newEndBlockNumberResult.timestamp,
  };
}

const MINERAL_SEASON = 0;
const OARB_SEASON = 0;
const OMATIC_SEASON = 0;

/**
 * path cannot start with a "/"
 */
export function getMineralConfigFileNameWithPath(networkId: number): string {
  return `config/${networkId}/mineral-season-${MINERAL_SEASON}.json`
}

/**
 * path cannot start with a "/"
 */
export function getOTokenConfigFileNameWithPath(networkId: number, oTokenType: OTokenType): string {
  return `config/${networkId}/${oTokenType}-season-${getSeasonForOTokenType(oTokenType)}.json`
}

/**
 * path cannot start with a "/"
 */
export function getFinalizedMineralMetadataFileNameWithPath(networkId: number): string {
  return `finalized/${networkId}/minerals/metadata.json`
}

/**
 * path cannot start with a "/"
 */
export function getFinalizedOTokenMetadataFileNameWithPath(networkId: number, oTokenType: OTokenType): string {
  return `finalized/${networkId}/${oTokenType}/metadata.json`
}

/**
 * path cannot start with a "/"
 */
export function getFinalizedMineralFileNameWithPath(networkId: number, epoch: number): string {
  return `finalized/${networkId}/minerals/minerals-season-${MINERAL_SEASON}-epoch-${epoch}.json`
}

/**
 * path cannot start with a "/"
 */
export function getFinalizedOTokenFileNameWithPath(networkId: number, oTokenType: OTokenType, epoch: number): string {
  const season = getSeasonForOTokenType(oTokenType);
  return `finalized/${networkId}/${oTokenType}/${oTokenType}-season-${season}-epoch-${epoch}.json`
}

function getSeasonForOTokenType(oTokenType: OTokenType): number {
  if (oTokenType === OTokenType.oARB) {
    return OARB_SEASON;
  } else if (oTokenType === OTokenType.oMATIC) {
    return OMATIC_SEASON;
  }

  throw new Error(`Invalid oTokenType, found ${oTokenType}`);
}
