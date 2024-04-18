import { getLatestBlockNumberByTimestamp } from '../../src/clients/blocks';

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
