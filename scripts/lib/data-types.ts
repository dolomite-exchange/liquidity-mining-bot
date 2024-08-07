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
    totalUsers: number;
    startBlockNumber: number;
    syncBlockNumber: number;
    endBlockNumber: number;
    startTimestamp: number;
    syncTimestamp: number;
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
  marketIdReward: string; // decimal
}

export interface MineralConfigFile extends ConfigFile<MineralConfigEpoch> {
}

export interface MineralYtConfigFile extends ConfigFile<MineralYtConfigEpoch> {
}

export enum OTokenType {
  oARB = 'oarb',
  oMATIC = 'omatic',
}

export interface OTokenEpochMetadata extends EpochMetadata {
  deltas: number[]
}

export interface OTokenOutputFile {
  users: {
    [walletAddressLowercase: string]: {
      amount: string // big int
      proofs: string[]
    }
  };
  metadata: {
    epoch: number;
    merkleRoot: string | null;
    marketTotalPointsForEpoch: {
      [market: string]: string // big int
    }
  };
}

export interface OTokenConfigEpoch extends EpochConfig {
  oTokenAmount: string;
  rewardWeights: Record<string, string>;
}

export interface OTokenConfigFile extends ConfigFile<OTokenConfigEpoch> {
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

export interface NextConfig {
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
