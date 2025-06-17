export interface UserMineralAllocationForFile {
  amount: string; // big int
  multiplier: string; // decimal
  proofs: string[];
}

export interface UserPendleMineralAllocationForFile {
  amount: string; // big int
  proofs: string[];
  marketIdToAmountMap: {
    [marketId: string]: string; // big int; represents how much of `amount` the user earned for each `marketId`
  }
}

export interface MineralPendleOutputFile {
  users: {
    [walletAddressLowercase: string]: UserPendleMineralAllocationForFile;
  };
  metadata: {
    epoch: number;
    merkleRoot: string | null;
    marketIdToRewardMap: {
      [marketId: string]: number;
    };
    totalAmount: string; // big int
    totalUsers: number;
    startBlockNumber: number;
    syncBlockNumber: number; // The block number at which the latest sync occurred
    endBlockNumber: number;
    startTimestamp: number;
    syncTimestamp: number; // The next timestamp to use to fetch data; not to be confused with `syncBlockNumber`
    endTimestamp: number;
    boostedMultiplier: number; // decimal
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
    [marketId: string]: number;
  };
  boostedMultiplier: string | undefined | null; // decimal
}

export interface MineralPendleConfigEpoch extends EpochConfig {
  boostedMultiplier: number; // decimal
  marketIdToRewardMap: {
    [marketId: string]: number; // Represents the amount of minerals earned per unit of marketId
  };
}

export interface MineralConfigFile extends ConfigFile<MineralConfigEpoch> {
}

export interface MineralPendleConfigFile extends ConfigFile<MineralPendleConfigEpoch> {
}

export enum OTokenType {
  oARB = 'oarb',
  oDOLO = 'odolo',
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

export interface ODoloOutputFile {
  users: {
    [walletAddressLowercase: string]: {
      amount: string // big int
      leaf: string
    }
  };
  metadata: {
    epoch: number;
    totalUsers: number;
    totalODolo: string // big int
    cumulativeODolo: string // big int
    merkleRoot: string;
    marketTotalPointsForEpoch: {
      [market: string]: string // big int
    }
  };
}

export interface ODoloMetadataPerNetwork {
  totalUsers: number;
  amount: string; // big int
}

export interface ODoloAggregateUserData {
  amount: string // big int
  amountPerNetwork: {
    [network: string]: {
      amount: string; // big int
    };
  };
  leaf: string;
}

export interface ODoloAggregateOutputFile {
  users: {
    [walletAddressLowercase: string]: ODoloAggregateUserData;
  };
  metadata: {
    epoch: number;
    totalUsers: number;
    totalODolo: string; // big int
    cumulativeODolo: string; // big int
    merkleRoot: string;
    metadataPerNetwork: {
      [network: string]: ODoloMetadataPerNetwork;
    };
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
