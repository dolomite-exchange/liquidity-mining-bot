/* eslint-disable max-classes-per-file */
import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { MarketIndex } from '../../src/lib/api-types';
import { ONE_ETH_WEI } from '../../src/lib/constants';
import { toNextDailyTimestamp } from '../../src/lib/utils';
import { remapAccountToClaimableAccount } from './remapper';

export const ARB_VESTER_PROXY = '0x531BC6E97b65adF8B3683240bd594932Cfb63797'.toLowerCase();

export const BLACKLIST_ADDRESSES = process.env.BLACKLIST_ADDRESSES?.split(',') ?? []

const blacklistMap: Record<string, boolean> = BLACKLIST_ADDRESSES.reduce((map, address) => {
  if (!ethers.utils.isAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  map[address.toLowerCase()] = true;
  return map;
}, {});

export interface BalanceChangeEvent {
  amountDeltaPar: Decimal;
  interestIndex: MarketIndex;
  timestamp: number;
  serialId: number;
  effectiveUser: string;
  marketId: number;
}

export type VirtualLiquiditySnapshot = VirtualLiquiditySnapshotBalance;

type AccountOwner = string;
type AccountNumber = string;
type AccountMarketId = string;

// eslint-disable-next-line max-len
export type AccountToSubAccountToMarketToBalanceAndPointsMap = Record<AccountOwner, Record<AccountNumber, Record<AccountMarketId, BalanceAndRewardPoints | undefined> | undefined> | undefined>;
// eslint-disable-next-line max-len
export type AccountToSubAccountToMarketToBalanceChangeMap = Record<AccountOwner, Record<AccountNumber, Record<AccountMarketId, BalanceChangeEvent[] | undefined> | undefined> | undefined>;
export type AccountToVirtualLiquidityBalanceMap = Record<AccountOwner, VirtualBalanceAndRewardPoints | undefined>;
export type AccountToVirtualLiquiditySnapshotsMap = Record<AccountOwner, VirtualLiquiditySnapshot[] | undefined>;

export interface VirtualLiquidityPosition {
  id: string;
  marketId: number;
  effectiveUser: string;
  balancePar: Decimal;
}

interface VirtualLiquiditySnapshotBase {
  id: string;
  effectiveUser: string;
  timestamp: number;
}

export interface VirtualLiquiditySnapshotDeltaPar extends VirtualLiquiditySnapshotBase {
  deltaPar: Decimal; // can be positive or negative
}

export interface VirtualLiquiditySnapshotBalance extends VirtualLiquiditySnapshotBase {
  balancePar: Decimal; // the user's balance
}

export interface LiquidityPositionsAndEvents {
  userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap;
  virtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap;
}

export interface FinalPointsStruct {
  userToPointsMap: Record<string, Integer>;
  userToMarketToPointsMap: Record<string, Record<string, Integer>>;
  marketToPointsMap: Record<string, Integer>;
  totalUserPoints: Integer,
}

export enum InterestOperation {
  ADD_POSITIVE = 'ADD_POSITIVE',
  ADD_NEGATIVE = 'ADD_NEGATIVE',
  NEGATE = 'NEGATE',
  NOTHING = 'NOTHING',
}

export class BalanceAndRewardPoints {
  public rewardPoints: Decimal;
  public positiveInterestAccrued: Decimal;
  /**
   * This is a positive number
   */
  public negativeInterestAccrued: Decimal;

  constructor(
    public readonly effectiveUser: string,
    public readonly marketId: number,
    public pointsPerSecond: Decimal,
    private lastUpdated: number,
    private balancePar: Decimal,
  ) {
    this.rewardPoints = INTEGERS.ZERO;
    this.positiveInterestAccrued = INTEGERS.ZERO;
    this.negativeInterestAccrued = INTEGERS.ZERO;
  }

  isZero(): boolean {
    return this.balancePar.eq(INTEGERS.ZERO);
  }

  processEvent(event: BalanceChangeEvent, operation: InterestOperation): BigNumber {
    // Check invariants
    if (event.timestamp < this.lastUpdated) {
      throw new Error('Incorrect Event Order');
    }

    // Initialize variables
    let pointsUpdate = INTEGERS.ZERO;
    let negativeInterestDelta = INTEGERS.ZERO;
    let positiveInterestDelta = INTEGERS.ZERO;
    const timeDelta = new BigNumber(event.timestamp - this.lastUpdated);

    // Accrue interest
    if (operation !== InterestOperation.NOTHING) {
      if (this.balancePar.lt(INTEGERS.ZERO)) {
        const indexDelta = event.interestIndex.borrow.minus(INTEGERS.ONE);
        negativeInterestDelta = this.balancePar.abs().times(indexDelta);
        this.negativeInterestAccrued = this.negativeInterestAccrued.plus(negativeInterestDelta);
      } else if (this.balancePar.gt(INTEGERS.ZERO)) {
        const indexDelta = event.interestIndex.supply.minus(INTEGERS.ONE);
        positiveInterestDelta = this.balancePar.times(indexDelta);
        this.positiveInterestAccrued = this.positiveInterestAccrued.plus(positiveInterestDelta);
      }
    }

    // Accrue balance-based points
    if (operation === InterestOperation.ADD_NEGATIVE) {
      if (this.balancePar.lt(INTEGERS.ZERO)) {
        pointsUpdate = pointsUpdate.plus(this.balancePar.abs().times(timeDelta).times(this.pointsPerSecond));
      }
    } else if (this.balancePar.gt(INTEGERS.ZERO)) {
      pointsUpdate = pointsUpdate.plus(this.balancePar.times(timeDelta).times(this.pointsPerSecond));
    }

    // Accrue interest-based points
    if (operation === InterestOperation.ADD_POSITIVE) {
      pointsUpdate = pointsUpdate.plus(positiveInterestDelta.times(timeDelta).times(this.pointsPerSecond));
    } else if (operation === InterestOperation.ADD_NEGATIVE) {
      pointsUpdate = pointsUpdate.plus(negativeInterestDelta.times(timeDelta).times(this.pointsPerSecond));
    } else if (operation === InterestOperation.NEGATE) {
      pointsUpdate = pointsUpdate.plus(positiveInterestDelta.minus(negativeInterestDelta)
        .times(timeDelta)
        .times(this.pointsPerSecond));
    } else if (operation !== InterestOperation.NOTHING) {
      throw new Error(`Invalid operation, found: ${operation}`);
    }

    this.rewardPoints = this.rewardPoints.plus(pointsUpdate);
    this.balancePar = this.balancePar.plus(event.amountDeltaPar);
    this.lastUpdated = event.timestamp;

    return pointsUpdate;
  }
}

export class VirtualBalanceAndRewardPoints {
  public equityPoints: Decimal;

  constructor(
    public readonly effectiveUser: string,
    public lastUpdated: number,
    public balancePar: Decimal,
  ) {
    this.equityPoints = INTEGERS.ZERO;
  }

  processLiquiditySnapshot(liquiditySnapshot: VirtualLiquiditySnapshot): BigNumber {
    if (liquiditySnapshot.timestamp < this.lastUpdated) {
      throw new Error('Incorrect Event Order');
    }

    let pointsUpdate = INTEGERS.ZERO;
    if (this.balancePar.gt(INTEGERS.ZERO)) {
      const timeDelta = new BigNumber(liquiditySnapshot.timestamp - this.lastUpdated);
      pointsUpdate = this.balancePar.times(timeDelta);
      this.equityPoints = this.equityPoints.plus(pointsUpdate);
    }
    this.balancePar = liquiditySnapshot.balancePar;
    this.lastUpdated = liquiditySnapshot.timestamp;

    return pointsUpdate;
  }
}

export function processEventsUntilEndTimestamp(
  accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceAndPointsMap,
  accountToMarketToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap,
  endInterestIndexMap: Record<string, MarketIndex>,
  marketToPointsPerSecondMap: Record<string, Decimal>,
  endTimestamp: number,
  operation: InterestOperation,
) {
  Object.keys(accountToMarketToEventsMap).forEach(account => {
    Object.keys(accountToMarketToEventsMap[account]!).forEach(subAccount => {
      // Make sure user => subAccount ==> market => balance record exists
      if (!accountToDolomiteBalanceMap[account]) {
        accountToDolomiteBalanceMap[account] = {};
      }
      if (!accountToDolomiteBalanceMap[account]![subAccount]) {
        accountToDolomiteBalanceMap[account]![subAccount] = {};
      }
      const marketToEventsMap = accountToMarketToEventsMap[account]![subAccount]!;
      Object.keys(marketToEventsMap).forEach(market => {
        // Sort and process events
        marketToEventsMap[market]!.sort((a, b) => a.serialId - b.serialId);
        marketToEventsMap[market]!.forEach(event => {
          let userBalanceStruct = accountToDolomiteBalanceMap[account]![subAccount]![market]!;
          if (!userBalanceStruct) {
            // For the first event, initialize the struct. Don't process it because we need to normalize the par value
            // if interest needs to be accrued for the `InterestOperation`
            userBalanceStruct = new BalanceAndRewardPoints(
              event.effectiveUser,
              event.interestIndex.marketId,
              marketToPointsPerSecondMap[market] ?? INTEGERS.ONE,
              event.timestamp,
              event.amountDeltaPar,
            );
            accountToDolomiteBalanceMap[account]![subAccount]![market] = userBalanceStruct;
          } else {
            userBalanceStruct.processEvent(event, operation);
          }

          if (userBalanceStruct.effectiveUser !== event.effectiveUser) {
            throw new Error('Effective user mismatch!');
          }
        });

        const userBalanceStruct = accountToDolomiteBalanceMap[account]![subAccount]![market]!;
        if (userBalanceStruct.isZero() && userBalanceStruct.rewardPoints.eq(0)) {
          delete accountToDolomiteBalanceMap[account]![subAccount]![market];
        }
      });
      if (Object.keys(accountToDolomiteBalanceMap[account]![subAccount]!).length === 0) {
        delete accountToDolomiteBalanceMap[account]![subAccount];
      }
    });
    if (
      accountToDolomiteBalanceMap[account]
      && Object.keys(accountToDolomiteBalanceMap[account]!).length === 0
    ) {
      delete accountToDolomiteBalanceMap[account];
    }
  });

  // Do final loop through all balances to finish reward point calculation
  Object.keys(accountToDolomiteBalanceMap).forEach(account => {
    Object.keys(accountToDolomiteBalanceMap[account]!).forEach(subAccount => {
      Object.keys(accountToDolomiteBalanceMap[account]![subAccount]!).forEach(market => {
        const userBalanceStruct = accountToDolomiteBalanceMap[account]![subAccount]![market]!;
        const endInterestIndex = endInterestIndexMap[market];
        if (endInterestIndex) {
          userBalanceStruct.processEvent(
            {
              amountDeltaPar: INTEGERS.ZERO,
              timestamp: endTimestamp,
              serialId: 0,
              effectiveUser: userBalanceStruct.effectiveUser,
              interestIndex: endInterestIndex,
              marketId: parseInt(market, 10),
            },
            operation,
          );
        }
      });
    });
  });
}

export function processEventsWithDifferingPointsBasedOnTimestampUntilEndTimestamp(
  accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceAndPointsMap,
  accountToMarketToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap,
  endInterestIndexMap: Record<string, MarketIndex>,
  dailyTimestampToMarketToPointsPerSecondMap: Record<string, Record<string, Decimal>>,
  endTimestamp: number,
  operation: InterestOperation,
) {
  Object.keys(accountToMarketToEventsMap).forEach(account => {
    Object.keys(accountToMarketToEventsMap[account]!).forEach(subAccount => {
      // Make sure user => subAccount ==> market => balance record exists
      if (!accountToDolomiteBalanceMap[account]) {
        accountToDolomiteBalanceMap[account] = {};
      }
      if (!accountToDolomiteBalanceMap[account]![subAccount]) {
        accountToDolomiteBalanceMap[account]![subAccount] = {};
      }
      const marketToEventsMap = accountToMarketToEventsMap[account]![subAccount]!;
      Object.keys(marketToEventsMap).forEach(market => {
        // Sort and process events
        marketToEventsMap[market]!.sort((a, b) => a.serialId - b.serialId);
        marketToEventsMap[market]!.forEach(event => {
          let userBalanceStruct = accountToDolomiteBalanceMap[account]![subAccount]![market]!;
          const dailyTimestamp = toNextDailyTimestamp(event.timestamp);
          const pointsPerSecond = dailyTimestampToMarketToPointsPerSecondMap[dailyTimestamp][market]!;
          if (!userBalanceStruct) {
            // For the first event, initialize the struct. Don't process it because we need to normalize the par value
            // if interest needs to be accrued for the `InterestOperation`
            userBalanceStruct = new BalanceAndRewardPoints(
              event.effectiveUser,
              event.interestIndex.marketId,
              pointsPerSecond,
              event.timestamp,
              event.amountDeltaPar,
            );
            accountToDolomiteBalanceMap[account]![subAccount]![market] = userBalanceStruct;
          } else {
            userBalanceStruct.pointsPerSecond = pointsPerSecond;
            userBalanceStruct.processEvent(event, operation);
          }

          if (userBalanceStruct.effectiveUser !== event.effectiveUser) {
            throw new Error('Effective user mismatch!');
          }
        });

        const userBalanceStruct = accountToDolomiteBalanceMap[account]![subAccount]![market]!;
        if (userBalanceStruct.isZero() && userBalanceStruct.rewardPoints.eq(0)) {
          delete accountToDolomiteBalanceMap[account]![subAccount]![market];
        }
      });
      if (Object.keys(accountToDolomiteBalanceMap[account]![subAccount]!).length === 0) {
        delete accountToDolomiteBalanceMap[account]![subAccount];
      }
    });
    if (
      accountToDolomiteBalanceMap[account]
      && Object.keys(accountToDolomiteBalanceMap[account]!).length === 0
    ) {
      delete accountToDolomiteBalanceMap[account];
    }
  });

  // Do final loop through all balances to finish reward point calculation
  Object.keys(accountToDolomiteBalanceMap).forEach(account => {
    Object.keys(accountToDolomiteBalanceMap[account]!).forEach(subAccount => {
      Object.keys(accountToDolomiteBalanceMap[account]![subAccount]!).forEach(market => {
        const userBalanceStruct = accountToDolomiteBalanceMap[account]![subAccount]![market]!;
        const endInterestIndex = endInterestIndexMap[market];
        if (endInterestIndex) {
          const dailyTimestamp = toNextDailyTimestamp(endTimestamp);
          userBalanceStruct.pointsPerSecond = dailyTimestampToMarketToPointsPerSecondMap[dailyTimestamp][market]!;
          userBalanceStruct.processEvent(
            {
              amountDeltaPar: INTEGERS.ZERO,
              timestamp: endTimestamp,
              serialId: 0,
              effectiveUser: userBalanceStruct.effectiveUser,
              interestIndex: endInterestIndex,
              marketId: parseInt(market, 10),
            },
            operation,
          );
        }
      });
    });
  });
}

export function addToBlacklist(account: string): void {
  blacklistMap[account.toLowerCase()] = true;
}

/**
 * @return A map from pool address to total points earned by the pool. This is used to divvy up earnings by the pool to
 * each user of the pool.
 */
export function calculateVirtualLiquidityPoints(
  poolToVirtualLiquidityPositionsAndEvents: Record<string, LiquidityPositionsAndEvents>,
  startTimestamp: number,
  endTimestamp: number,
): Record<string, Decimal> {
  // Warning: do not exclude the blacklisted users here. It can over-inflate the equity of other users then!
  const poolToTotalLiquidityPoints: Record<string, Decimal> = {};
  Object.keys(poolToVirtualLiquidityPositionsAndEvents).forEach(pool => {
    poolToTotalLiquidityPoints[pool] = INTEGERS.ZERO;
    const { userToLiquiditySnapshots, virtualLiquidityBalances } = poolToVirtualLiquidityPositionsAndEvents[pool];

    Object.keys(userToLiquiditySnapshots).forEach(account => {
      userToLiquiditySnapshots[account]!.sort((a, b) => {
        return a.timestamp - b.timestamp;
      });
      virtualLiquidityBalances[account] = virtualLiquidityBalances[account] ?? new VirtualBalanceAndRewardPoints(
        account,
        startTimestamp,
        INTEGERS.ZERO,
      );

      userToLiquiditySnapshots[account]!.forEach((liquiditySnapshot) => {
        poolToTotalLiquidityPoints[pool] = poolToTotalLiquidityPoints[pool].plus(
          virtualLiquidityBalances[account]!.processLiquiditySnapshot(liquiditySnapshot),
        );
      });
    });
  });

  // Iterate through balances to finish reward point calculation
  Object.keys(poolToVirtualLiquidityPositionsAndEvents).forEach(pool => {
    const { virtualLiquidityBalances } = poolToVirtualLiquidityPositionsAndEvents[pool];

    Object.keys(virtualLiquidityBalances).forEach(account => {
      const balanceStruct = virtualLiquidityBalances[account]!;
      const points = balanceStruct.processLiquiditySnapshot({
        id: '-1',
        effectiveUser: balanceStruct.effectiveUser,
        balancePar: balanceStruct.balancePar,
        timestamp: endTimestamp,
      });
      poolToTotalLiquidityPoints[pool] = poolToTotalLiquidityPoints[pool].plus(points);
    });
  });

  return poolToTotalLiquidityPoints;
}

/**
 * @return Maps containing points, which is an BigInt with 18 decimals of precision
 */
export function calculateFinalPoints(
  networkId: number,
  accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceAndPointsMap,
  validMarketIdsMap: Record<string, Integer | Decimal>,
  poolToVirtualLiquidityPositionsAndEvents: Record<string, LiquidityPositionsAndEvents>,
  poolToTotalSubLiquidityPoints: Record<string, Decimal>,
  oldUserToPointsMap: Record<string, string> = {},
  oldUserToMarketToPointsMap: Record<string, string> = {},
): FinalPointsStruct {
  let totalUserPoints = INTEGERS.ZERO;
  const userToPointsMap = Object.keys(oldUserToPointsMap).reduce((memo, key) => {
    memo[key] = new BigNumber(oldUserToPointsMap[key]);
    return memo;
  }, {} as Record<string, Integer>);
  const userToMarketToPointsMap = Object.keys(oldUserToMarketToPointsMap).reduce((memo1, user) => {
    memo1[user] = Object.keys(userToMarketToPointsMap[user]).reduce<Record<string, Integer>>((memo2, market) => {
      memo2[market] = new BigNumber(oldUserToMarketToPointsMap[user][market]);
      return memo2;
    }, {});
    return memo1;
  }, {} as Record<string, Record<string, Integer>>);

  Object.keys(accountToDolomiteBalanceMap).forEach(account => {
    Object.keys(accountToDolomiteBalanceMap[account]!).forEach(subAccount => {
      Object.keys(accountToDolomiteBalanceMap[account]![subAccount]!).forEach(market => {
        if (validMarketIdsMap[market] && !blacklistMap[account]) {
          const balanceStruct = accountToDolomiteBalanceMap[account]![subAccount]![market]!;

          const remappedAccount = remapAccountToClaimableAccount(networkId, balanceStruct.effectiveUser);
          if (!userToPointsMap[remappedAccount]) {
            userToPointsMap[remappedAccount] = INTEGERS.ZERO;
          }
          if (!userToMarketToPointsMap[remappedAccount]) {
            userToMarketToPointsMap[remappedAccount] = {};
          }
          if (!userToMarketToPointsMap[remappedAccount][market]) {
            userToMarketToPointsMap[remappedAccount][market] = INTEGERS.ZERO;
          }

          const points = balanceStruct.rewardPoints.times(ONE_ETH_WEI).integerValue();
          totalUserPoints = totalUserPoints.plus(points);
          userToPointsMap[remappedAccount] = userToPointsMap[remappedAccount].plus(points);
          userToMarketToPointsMap[remappedAccount][market] = userToMarketToPointsMap[remappedAccount][market].plus(
            points,
          );
        }
      });
    });
  });

  // Distribute liquidity pool rewards
  Object.keys(poolToVirtualLiquidityPositionsAndEvents).forEach(pool => {
    const totalLiquidityPoolPoints = userToPointsMap[pool];
    const totalMarketToLiquidityPoolPointsMap = userToMarketToPointsMap[pool];
    const totalPoolEquityPoints = poolToTotalSubLiquidityPoints[pool];
    let totalWhitelistPoints = INTEGERS.ZERO;

    if (totalLiquidityPoolPoints && totalPoolEquityPoints && totalMarketToLiquidityPoolPointsMap) {
      const events = poolToVirtualLiquidityPositionsAndEvents[pool];
      Object.keys(events.virtualLiquidityBalances).forEach(account => {
        if (!blacklistMap[account]) {
          const balances = events.virtualLiquidityBalances[account]!;
          const points = totalLiquidityPoolPoints
            .times(balances.equityPoints)
            .dividedToIntegerBy(totalPoolEquityPoints);

          const remappedAccount = remapAccountToClaimableAccount(networkId, account);
          if (!userToPointsMap[remappedAccount]) {
            userToPointsMap[remappedAccount] = INTEGERS.ZERO;
          }
          userToPointsMap[remappedAccount] = userToPointsMap[remappedAccount].plus(points);
          totalWhitelistPoints = totalWhitelistPoints.plus(points);

          Object.keys(totalMarketToLiquidityPoolPointsMap).forEach(market => {
            if (!userToMarketToPointsMap[remappedAccount]) {
              userToMarketToPointsMap[remappedAccount] = {};
            }
            if (!userToMarketToPointsMap[remappedAccount][market]) {
              userToMarketToPointsMap[remappedAccount][market] = INTEGERS.ZERO;
            }

            userToMarketToPointsMap[remappedAccount][market] = userToMarketToPointsMap[remappedAccount][market]
              .plus(points);
          });
        }
      });
    }

    delete userToPointsMap[pool];

    if (userToMarketToPointsMap[pool] && Object.keys(userToMarketToPointsMap[pool]).length === 0) {
      delete userToMarketToPointsMap[pool];
    }
  });

  // Remove all users with 0 points
  Object.keys(userToPointsMap).forEach(user => {
    if (userToPointsMap[user].eq(INTEGERS.ZERO)) {
      delete userToPointsMap[user];
    }
  });

  const marketToPointsMap: Record<string, Integer> = {};
  Object.keys(userToMarketToPointsMap).forEach(user => {
    Object.keys(userToMarketToPointsMap[user]).forEach(market => {
      if (!marketToPointsMap[market]) {
        marketToPointsMap[market] = INTEGERS.ZERO;
      }
      marketToPointsMap[market] = marketToPointsMap[market].plus(userToMarketToPointsMap[user][market]);
    });
  });

  return { userToPointsMap, userToMarketToPointsMap, marketToPointsMap, totalUserPoints };
}

export function calculateFinalEquityRewards(
  networkId: number,
  accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceAndPointsMap,
  poolToVirtualLiquidityPositionsAndEvents: Record<string, LiquidityPositionsAndEvents>,
  totalPointsPerMarket: Record<number, Decimal>,
  totalLiquidityPointsPerPool: Record<string, Decimal>,
  validOTokenRewardsMap: Record<number, Integer | undefined>,
  minimumOTokenAmount: Integer,
): Record<string, Integer> {
  const userToOTokenRewards: Record<string, Integer> = {};
  Object.keys(accountToDolomiteBalanceMap).forEach(account => {
    if (!blacklistMap[account.toLowerCase()]) {
      Object.keys(accountToDolomiteBalanceMap[account]!).forEach(subAccount => {
        Object.keys(accountToDolomiteBalanceMap[account]![subAccount]!).forEach(market => {
          const rewards = validOTokenRewardsMap[market];
          if (rewards) {
            const points = accountToDolomiteBalanceMap[account]![subAccount]![market]!;
            const oTokenReward = rewards.times(points.rewardPoints).dividedToIntegerBy(totalPointsPerMarket[market]);

            const remappedAccount = remapAccountToClaimableAccount(networkId, points.effectiveUser);
            if (!userToOTokenRewards[remappedAccount]) {
              userToOTokenRewards[remappedAccount] = INTEGERS.ZERO;
            }
            userToOTokenRewards[remappedAccount] = userToOTokenRewards[remappedAccount].plus(oTokenReward);
          }
        });
      });
    }
  });

  // Distribute liquidity pool rewards
  Object.keys(poolToVirtualLiquidityPositionsAndEvents).forEach(pool => {
    const liquidityPoolReward: Integer = userToOTokenRewards[pool];
    if (liquidityPoolReward && liquidityPoolReward.gt(INTEGERS.ZERO) && totalLiquidityPointsPerPool[pool]) {
      const events = poolToVirtualLiquidityPositionsAndEvents[pool];
      Object.keys(events.virtualLiquidityBalances).forEach(account => {
        if (!blacklistMap[account.toLowerCase()]) {
          const balances = events.virtualLiquidityBalances[account]!;
          const rewardAmount = liquidityPoolReward.times(balances.equityPoints)
            .dividedToIntegerBy(totalLiquidityPointsPerPool[pool]);

          const remappedAccount = remapAccountToClaimableAccount(networkId, account);
          if (!userToOTokenRewards[remappedAccount]) {
            userToOTokenRewards[remappedAccount] = INTEGERS.ZERO;
          }
          userToOTokenRewards[remappedAccount] = userToOTokenRewards[remappedAccount].plus(rewardAmount);
        }
      });
    }

    delete userToOTokenRewards[pool];
  });

  let filteredAmount = INTEGERS.ZERO;
  const accounts = Object.keys(userToOTokenRewards);
  const finalizedRewardsMap = accounts.reduce<Record<string, BigNumber>>((map, account) => {
    if (userToOTokenRewards[account].gte(minimumOTokenAmount)) {
      map[account] = userToOTokenRewards[account];
    } else {
      filteredAmount = filteredAmount.plus(userToOTokenRewards[account]);
    }
    return map;
  }, {});

  console.log('oToken amount filtered out:', filteredAmount.dividedBy(ONE_ETH_WEI).toFixed(2));

  return finalizedRewardsMap;
}
