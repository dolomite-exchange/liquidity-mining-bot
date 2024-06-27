import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { MerkleTree } from 'merkletreejs';
import { MarketIndex } from '../../src/lib/api-types';
import { ONE_ETH_WEI } from '../../src/lib/constants';
import { remapAccountToClaimableAccount } from './remapper';

export const ETH_USDC_POOL = '0xb77a493a4950cad1b049e222d62bce14ff423c6f'.toLowerCase();
export const ARB_VESTER_PROXY = '0x531BC6E97b65adF8B3683240bd594932Cfb63797'.toLowerCase();
export const SY_D_USDC = '0x84e0efc0633041aac9d0196b7ac8af3505e8cc32'.toLowerCase();

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
}

interface AmountAndProof {
  amount: string;
  proofs: string[];
}

export type VirtualLiquiditySnapshot = VirtualLiquiditySnapshotBalance;

type AccountOwner = string;
type AccountNumber = string;
type AccountMarketId = string;

// eslint-disable-next-line max-len
export type AccountToSubAccountToMarketToBalanceMap = Record<AccountOwner, Record<AccountNumber, Record<AccountMarketId, BalanceAndRewardPoints | undefined> | undefined> | undefined>;
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
  deltaPar: BigNumber; // can be positive or negative
}

export interface VirtualLiquiditySnapshotBalance extends VirtualLiquiditySnapshotBase {
  balancePar: BigNumber; // the user's balance
}

export interface LiquidityPositionsAndEvents {
  userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap;
  virtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap;
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
    public readonly pointsPerSecond: Decimal,
    public readonly marketId: number,
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
        negativeInterestDelta = this.balancePar.times(indexDelta).abs();
        this.negativeInterestAccrued = this.negativeInterestAccrued.plus(negativeInterestDelta);
      } else if (this.balancePar.gt(INTEGERS.ZERO)) {
        const indexDelta = event.interestIndex.supply.minus(INTEGERS.ONE);
        positiveInterestDelta = this.balancePar.times(indexDelta);
        this.positiveInterestAccrued = this.positiveInterestAccrued.plus(positiveInterestDelta);
      }
    }

    // Accrue balance-based points
    if (this.balancePar.gt(0)) {
      pointsUpdate = pointsUpdate.plus(this.balancePar.times(timeDelta).times(this.pointsPerSecond));
    }

    // Accrue interest-based points
    if (operation === InterestOperation.ADD_POSITIVE) {
      pointsUpdate = pointsUpdate.plus(positiveInterestDelta.times(timeDelta).times(this.pointsPerSecond));
    } else if (operation === InterestOperation.ADD_NEGATIVE) {
      pointsUpdate = pointsUpdate.plus(negativeInterestDelta.abs().times(timeDelta).times(this.pointsPerSecond));
    } else if (operation === InterestOperation.NEGATE) {
      pointsUpdate = pointsUpdate.plus(positiveInterestDelta.minus(negativeInterestDelta)
        .times(timeDelta)
        .times(this.pointsPerSecond));
    } else {
      if (operation !== InterestOperation.NOTHING) {
        throw new Error(`Invalid operation, found: ${operation}`);
      }
    }

    this.rewardPoints = this.rewardPoints.plus(pointsUpdate);
    this.balancePar = this.balancePar.plus(event.amountDeltaPar);
    this.lastUpdated = event.timestamp;

    return pointsUpdate;
  }
}

export class VirtualBalanceAndRewardPoints {
  equityPoints: Decimal;

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
    if (this.balancePar.gt(0)) {
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
  accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceMap,
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
              marketToPointsPerSecondMap[market] ?? INTEGERS.ONE,
              event.interestIndex.marketId,
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
            },
            operation,
          );
        }
      });
    });
  });
}

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
  accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceMap,
  validMarketIdsMap: Record<string, any>,
  poolToVirtualLiquidityPositionsAndEvents: Record<string, LiquidityPositionsAndEvents>,
  poolToTotalSubLiquidityPoints: Record<string, Decimal>,
  oldUserToPointsMap: Record<string, string> = {},
  oldUserToMarketToPointsMap: Record<string, string> = {},
): {
  userToPointsMap: Record<string, Integer>;
  userToMarketToPointsMap: Record<string, Record<string, Integer>>;
  marketToPointsMap: Record<string, Integer>;
} {
  const marketToPointsMap: Record<string, Integer> = {};
  const userToPointsMap: Record<string, Integer> = Object.keys(oldUserToPointsMap)
    .reduce<Record<string, Integer>>((memo, key) => {
      memo[key] = new BigNumber(oldUserToPointsMap[key]);
      return memo;
    }, {});
  const userToMarketToPointsMap: Record<string, Record<string, Integer>> = Object.keys(oldUserToMarketToPointsMap)
    .reduce<Record<string, Record<string, Integer>>>((memo1, user) => {
      memo1[user] = Object.keys(userToMarketToPointsMap[user]).reduce<Record<string, Integer>>((memo2, market) => {
        memo2[market] = new BigNumber(oldUserToMarketToPointsMap[user][market]);
        return memo2;
      }, {});
      return memo1;
    }, {});

  Object.keys(accountToDolomiteBalanceMap).forEach(account => {
    Object.keys(accountToDolomiteBalanceMap[account]!).forEach(subAccount => {
      Object.keys(accountToDolomiteBalanceMap[account]![subAccount]!).forEach(market => {
        if (validMarketIdsMap[market] && !blacklistMap[account]) {
          const balanceStruct = accountToDolomiteBalanceMap[account]![subAccount]![market]!;
          if (!marketToPointsMap[market]) {
            marketToPointsMap[market] = INTEGERS.ZERO;
          }

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

          const points = balanceStruct.rewardPoints.times(ONE_ETH_WEI).dividedToIntegerBy(INTEGERS.ONE);
          userToPointsMap[remappedAccount] = userToPointsMap[remappedAccount].plus(points);
          marketToPointsMap[market] = marketToPointsMap[market].plus(points);
          userToMarketToPointsMap[remappedAccount][market] = userToMarketToPointsMap[remappedAccount][market].plus(
            points);
        }
      });
    });
  });

  // Distribute liquidity pool rewards
  Object.keys(poolToVirtualLiquidityPositionsAndEvents).forEach(pool => {
    const totalLiquidityPoolPoints = userToPointsMap[pool];
    const totalPoolEquityPoints = poolToTotalSubLiquidityPoints[pool];
    let totalWhitelistPoints = INTEGERS.ZERO;
    if (totalLiquidityPoolPoints && totalPoolEquityPoints) {
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
        }
      });
    }

    Object.keys(userToMarketToPointsMap[pool] ?? {}).forEach(market => {
      // Get rid of points accrued by the blacklist for that particular market's total points
      const pointsFromMarket = userToMarketToPointsMap[pool][market];
      const whitelistPointsFromMarket = pointsFromMarket.times(totalWhitelistPoints)
        .dividedToIntegerBy(totalLiquidityPoolPoints);
      const blacklistPoints = pointsFromMarket.minus(whitelistPointsFromMarket);
      marketToPointsMap[market] = marketToPointsMap[market].minus(blacklistPoints);
    })
    delete userToPointsMap[pool];
  });
  1

  // Remove all users with 0 points
  Object.keys(userToPointsMap).forEach(user => {
    if (userToPointsMap[user].eq(INTEGERS.ZERO)) {
      delete userToPointsMap[user];
    }
  });

  return { userToPointsMap, userToMarketToPointsMap, marketToPointsMap };
}

export function calculateFinalEquityRewards(
  networkId: number,
  accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceMap,
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

export interface MerkleRootAndProofs {
  merkleRoot: string;
  walletAddressToLeavesMap: Record<string, AmountAndProof>; // wallet ==> proofs + amounts
}

export function calculateMerkleRootAndProofs(userToAmounts: Record<string, Integer>): MerkleRootAndProofs {
  const walletAddressToFinalDataMap: Record<string, AmountAndProof> = {};
  const leaves: string[] = [];
  const userAccounts = Object.keys(userToAmounts);
  userAccounts.forEach(account => {
    const userAmount = userToAmounts[account];
    const leaf = keccak256(
      defaultAbiCoder.encode(
        ['address', 'uint256'],
        [account, userAmount.toFixed(0)],
      ),
    );
    walletAddressToFinalDataMap[account.toLowerCase()] = {
      amount: userAmount.toFixed(0),
      proofs: [leaf], // this will get overwritten once the tree is created
    };
    leaves.push(leaf);
  });

  const tree = new MerkleTree(leaves, keccak256, { sort: true });
  const merkleRoot = tree.getHexRoot();

  userAccounts.forEach(account => {
    const finalData = walletAddressToFinalDataMap[account.toLowerCase()];
    finalData.proofs = tree.getHexProof(finalData.proofs[0]);
  });

  return { merkleRoot, walletAddressToLeavesMap: walletAddressToFinalDataMap };
}
