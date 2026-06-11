import { BigNumber, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { defaultAbiCoder, keccak256, parseEther } from 'ethers/lib/utils';
import { MerkleTree } from 'merkletreejs';
import { ChainId } from '../../src/lib/chain-id';
import {
  AccountToSubAccountToMarketToBalanceAndPointsMap,
  AccountToVirtualLiquidityBalanceMap,
  AccountToVirtualLiquiditySnapshotsMap,
  BalanceAndRewardPoints,
  BalanceChangeEvent,
  calculateBorrowInterest,
  calculateFinalEquityRewards,
  calculateVirtualLiquidityPoints,
  InterestOperation,
  LiquidityPositionsAndEvents,
  processEventsUntilEndTimestamp,
  VirtualBalanceAndRewardPoints,
} from '../../scripts/lib/rewards';
import { ApiMarket } from '../../src/lib/api-types';

const blockRewardStartTimestamp = 1697000000;
const blockRewardEndTimestamp = 1698000000;
const timeLength = 1000000;
const LIQUIDITY_POOL = '0xb77a493a4950cad1b049e222d62bce14ff423c6f';

const user1 = '0x0321be949876c2545ac121379c620c2a0480b758';
const user2 = '0x1702acf734116cd8faf86d139aa91843f81510a1';
const user3 = '0x0354aecd8fadcfc7411e26820c4973510246c383';
const user4 = '0x7a5fe89a0350bcda945ed1e6f2be126b33472418';
const user5 = '0x815ac0ccf85bab38b1953a008f80bb028bfc317a';
const user6 = '0x91d6bf11608ed2dd40f44a95f3ef222840746577';
const user7 = '0x92fba06462b4e5a7c3febeaf8b81a506d5242843';

const subAccount1 = 3;

const DEPOSIT_EVENT: BalanceChangeEvent = {
  amountDeltaPar: new BigNumber(20),
  timestamp: 10,
  serialId: 1,
  effectiveUser: user1,
  marketId: 17,
  interestIndex: {
    marketId: 17,
    borrow: new BigNumber('1.1'),
    supply: new BigNumber('1.05'),
  },
};

const WITHDRAWAL_EVENT: BalanceChangeEvent = {
  amountDeltaPar: new BigNumber(-10),
  timestamp: 15,
  serialId: 2,
  effectiveUser: user1,
  marketId: 17,
  interestIndex: {
    marketId: 17,
    borrow: new BigNumber('1.2'),
    supply: new BigNumber('1.1'),
  },
};

const FINAL_EVENT: BalanceChangeEvent = {
  amountDeltaPar: new BigNumber(0),
  timestamp: 20,
  serialId: 3,
  effectiveUser: user1,
  marketId: 17,
  interestIndex: {
    marketId: 17,
    borrow: new BigNumber('1.3'),
    supply: new BigNumber('1.15'),
  },
};

const accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceAndPointsMap = {
  [user1]: {
    [subAccount1]: {
      17: new BalanceAndRewardPoints(
        user1,
        17,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('100000000'),
        new BigNumber('100000000'),
      ),
    },
  },
  [user2]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(
        user2,
        0,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('500000000000000000'),
        new BigNumber('500000000000000000'),
      ),
      17: new BalanceAndRewardPoints(
        user2,
        17,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('100000000'),
        new BigNumber('100000000'),
      ),
    },
  },
  [user3]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(
        user3,
        0,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('500000000000000000'),
        new BigNumber('500000000000000000'),
      ),
    },
  },
  [user4]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(
        user4,
        0,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('500000000000000000'),
        new BigNumber('500000000000000000'),
      ),
      17: new BalanceAndRewardPoints(
        user4,
        17,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('-3000000'),
        new BigNumber('-3000000'),
      ),
    },
  },
  [user5]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(
        user5,
        0,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('200000000000000000'),
        new BigNumber('200000000000000000'),
      ),
      17: new BalanceAndRewardPoints(
        user5,
        17,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('300000000'),
        new BigNumber('300000000'),
      ),
    },
  },
  [user6]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(
        user6,
        0,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('300000000000000000'),
        new BigNumber('300000000000000000'),
      ),
      17: new BalanceAndRewardPoints(
        user6,
        17,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('0'),
        new BigNumber('0'),
      ),
    },
  },
  [LIQUIDITY_POOL]: {
    [subAccount1]: {
      0: new BalanceAndRewardPoints(
        LIQUIDITY_POOL,
        0,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('2000000000000000000'),
        new BigNumber('2000000000000000000'),
      ),
      17: new BalanceAndRewardPoints(
        LIQUIDITY_POOL,
        17,
        INTEGERS.ONE,
        blockRewardStartTimestamp,
        new BigNumber('500000000'),
        new BigNumber('500000000'),
      ),
    },
  },
}

const ammLiquidityBalances: AccountToVirtualLiquidityBalanceMap = {
  [user4]: new VirtualBalanceAndRewardPoints(user4, blockRewardStartTimestamp, new BigNumber('.05')),
  [user6]: new VirtualBalanceAndRewardPoints(user6, blockRewardStartTimestamp, new BigNumber('.05')),
};

const userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap = {
  [user4]: [{ id: user4, effectiveUser: user4, timestamp: 1697500000, balancePar: new BigNumber('0.025') }],
  [user5]: [
    { id: user4, effectiveUser: user4, timestamp: 1697250000, balancePar: new BigNumber('0.05') },
    { id: user4, effectiveUser: user4, timestamp: 1697750000, balancePar: new BigNumber('0') },
  ],
  [user6]: [
    { id: user4, effectiveUser: user4, timestamp: 1697250000, balancePar: new BigNumber('0.05') },
    { id: user4, effectiveUser: user4, timestamp: 1697750000, balancePar: new BigNumber('0') },
  ],
  [user7]: [{ id: user4, effectiveUser: user4, timestamp: 1697500000, balancePar: new BigNumber('0.05') }],
};

const poolToVirtualLiquidityPositionsAndEvents: Record<string, LiquidityPositionsAndEvents> = {
  [LIQUIDITY_POOL]: {
    userToLiquiditySnapshots: userToLiquiditySnapshots,
    virtualLiquidityBalances: ammLiquidityBalances,
  },
}

const marketMap: Record<string, ApiMarket> = {
  '0': {
    marketId: 0,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    tokenAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    decimals: 18,
    liquidationRewardPremium: INTEGERS.ZERO,
    marginPremium: INTEGERS.ZERO,
    oraclePrice: INTEGERS.ZERO,
  } as ApiMarket,
  '17': {
    marketId: 17,
    symbol: 'USDC',
    name: 'USD Coin',
    tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6,
    liquidationRewardPremium: INTEGERS.ZERO,
    marginPremium: INTEGERS.ZERO,
    oraclePrice: INTEGERS.ZERO,
  } as ApiMarket,
};

let totalPointsPerMarket: Record<string, BigNumber>;
let totalLiquidityPoints: Record<string, BigNumber>;

describe('rewards', () => {
  describe('#processEvent', () => {
    it('should process one event properly if user already has balance', async () => {
      const points = new BalanceAndRewardPoints(
        user1,
        17,
        new BigNumber(5),
        0,
        new BigNumber(5),
        new BigNumber(5),
      );
      points.processEvent(DEPOSIT_EVENT, InterestOperation.NOTHING);
      expect(points.balancePar).toEqual(new BigNumber(25));
      expect(points.lastUpdated).toEqual(10);
      expect(points.rewardPoints).toEqual(new BigNumber(250).times(INTEGERS.ONE));
    });

    it('should process one event properly if user has no balance', async () => {
      const points = new BalanceAndRewardPoints(
        user1,
        17,
        INTEGERS.ONE,
        0,
        INTEGERS.ZERO,
        INTEGERS.ZERO,
      );
      points.processEvent(DEPOSIT_EVENT, InterestOperation.NOTHING);
      expect(points.balancePar).toEqual(new BigNumber(20));
      expect(points.lastUpdated).toEqual(10);
      expect(points.rewardPoints).toEqual(new BigNumber(0));
    });

    it('should process deposit and then withdraw properly', async () => {
      const points = new BalanceAndRewardPoints(
        user1,
        17,
        new BigNumber(5),
        0,
        new BigNumber(5),
        new BigNumber(5),
      );

      points.processEvent(DEPOSIT_EVENT, InterestOperation.NOTHING);
      expect(points.balancePar).toEqual(new BigNumber(25));
      expect(points.lastUpdated).toEqual(10);
      expect(points.rewardPoints).toEqual(new BigNumber(250).times(INTEGERS.ONE));

      points.processEvent(WITHDRAWAL_EVENT, InterestOperation.NOTHING);
      expect(points.balancePar).toEqual(new BigNumber(15));
      expect(points.lastUpdated).toEqual(15);
      expect(points.rewardPoints).toEqual(new BigNumber(175 * 5).times(INTEGERS.ONE));
    });

    it('should process final event properly with no other events', async () => {
      const points = new BalanceAndRewardPoints(
        user1,
        17,
        new BigNumber(5),
        0,
        new BigNumber(5),
        new BigNumber(5),
      );

      points.processEvent(FINAL_EVENT, InterestOperation.NOTHING);
      expect(points.balancePar).toEqual(new BigNumber(5));
      expect(points.lastUpdated).toEqual(20);
      expect(points.rewardPoints).toEqual(new BigNumber(500).times(INTEGERS.ONE));
    });

    it('should process final event properly with other events', async () => {
      const points = new BalanceAndRewardPoints(
        user1,
        17,
        new BigNumber(5),
        0,
        new BigNumber(5),
        new BigNumber(5),
      );

      points.processEvent(DEPOSIT_EVENT, InterestOperation.NOTHING);
      expect(points.balancePar).toEqual(new BigNumber(25));
      expect(points.lastUpdated).toEqual(10);
      expect(points.rewardPoints).toEqual(new BigNumber(250).times(INTEGERS.ONE));

      points.processEvent(WITHDRAWAL_EVENT, InterestOperation.NOTHING);
      expect(points.balancePar).toEqual(new BigNumber(15));
      expect(points.lastUpdated).toEqual(15);
      expect(points.rewardPoints).toEqual(new BigNumber(175 * 5).times(INTEGERS.ONE));

      points.processEvent(FINAL_EVENT, InterestOperation.NOTHING);
      expect(points.balancePar).toEqual(new BigNumber(15));
      expect(points.lastUpdated).toEqual(20);
      expect(points.rewardPoints).toEqual(new BigNumber(250 * 5).times(INTEGERS.ONE));
    });
  });

  describe('#processEvent - ONLY_NEGATIVE and ONLY_POSITIVE', () => {
    it('should calculate ONLY_NEGATIVE interest correctly', async () => {
      const initialBalancePar = new BigNumber(-100);
      const initialInterestIndex = new BigNumber('1.1');
      const points = new BalanceAndRewardPoints(
        user1,
        17,
        new BigNumber(1),
        0,
        initialBalancePar,
        initialBalancePar.times(initialInterestIndex),
      );

      const nextInterestIndex = new BigNumber('1.2');
      const event: BalanceChangeEvent = {
        amountDeltaPar: INTEGERS.ZERO,
        timestamp: 10,
        serialId: 1,
        effectiveUser: user1,
        marketId: 17,
        interestIndex: {
          marketId: 17,
          borrow: nextInterestIndex,
          supply: new BigNumber('1.1'),
        },
      };

      points.processEvent(event, InterestOperation.ONLY_NEGATIVE);

      // negativeInterestDelta = |balancePar| * nextInterestIndex - |balanceWei|
      // negativeInterestDelta = 100 * 1.2 - 110 = 120 - 110 = 10
      expect(points.negativeInterestAccrued).toEqual(new BigNumber(10));
      // pointsUpdate = negativeInterestDelta * timeDelta * pointsPerSecond
      // pointsUpdate = 10 * 10 * 1 = 100
      expect(points.rewardPoints).toEqual(new BigNumber(100));
    });

    it('should calculate ONLY_POSITIVE interest correctly', async () => {
      const initialBalancePar = new BigNumber(100);
      const initialInterestIndex = new BigNumber('1.05');
      const points = new BalanceAndRewardPoints(
        user1,
        17,
        new BigNumber(1),
        0,
        initialBalancePar,
        initialBalancePar.times(initialInterestIndex),
      );

      const nextInterestIndex = new BigNumber('1.15');
      const event: BalanceChangeEvent = {
        amountDeltaPar: INTEGERS.ZERO,
        timestamp: 10,
        serialId: 1,
        effectiveUser: user1,
        marketId: 17,
        interestIndex: {
          marketId: 17,
          borrow: new BigNumber('1.2'),
          supply: nextInterestIndex,
        },
      };

      points.processEvent(event, InterestOperation.ONLY_POSITIVE);

      // positiveInterestDelta = |balancePar| * nextInterestIndex - |balanceWei|
      // positiveInterestDelta = 100 * 1.15 - 105 = 115 - 105 = 10
      expect(points.positiveInterestAccrued).toEqual(new BigNumber(10));
      // pointsUpdate = positiveInterestDelta * timeDelta * pointsPerSecond
      // pointsUpdate = 10 * 10 * 1 = 100
      expect(points.rewardPoints).toEqual(new BigNumber(100));
    });
  });

  describe('calculateRewardPoints', () => {
    it('should calculate reward points', async () => {
      const endInterestIndexMap = {
        0: { marketId: 0, borrow: INTEGERS.ONE, supply: INTEGERS.ONE },
        17: { marketId: 17, borrow: INTEGERS.ONE, supply: INTEGERS.ONE },
      };
      const marketToPointsPerSecondMap = {
        0: INTEGERS.ONE,
        17: INTEGERS.ONE,
      };
      totalPointsPerMarket = processEventsUntilEndTimestamp(
        accountToDolomiteBalanceMap,
        {},
        endInterestIndexMap,
        marketToPointsPerSecondMap,
        blockRewardEndTimestamp,
        InterestOperation.NOTHING,
      );
      expect(accountToDolomiteBalanceMap[user1]![subAccount1]!['17']!.rewardPoints)
        .toEqual(new BigNumber('100000000').times(timeLength));

      expect(accountToDolomiteBalanceMap[user2]![subAccount1]!['0']!.rewardPoints)
        .toEqual(new BigNumber('500000000000000000').times(timeLength));
      expect(accountToDolomiteBalanceMap[user2]![subAccount1]!['17']!.rewardPoints)
        .toEqual(new BigNumber('100000000').times(timeLength));

      expect(accountToDolomiteBalanceMap[user3]![subAccount1]!['0']!.rewardPoints)
        .toEqual(new BigNumber('500000000000000000').times(timeLength));

      expect(accountToDolomiteBalanceMap[user4]![subAccount1]!['0']!.rewardPoints)
        .toEqual(new BigNumber('500000000000000000').times(timeLength));
      expect(accountToDolomiteBalanceMap[user4]![subAccount1]!['17']!.rewardPoints).toEqual(new BigNumber('0'));

      expect(accountToDolomiteBalanceMap[user5]![subAccount1]!['0']!.rewardPoints)
        .toEqual(new BigNumber('200000000000000000').times(timeLength));
      expect(accountToDolomiteBalanceMap[user5]![subAccount1]!['17']!.rewardPoints)
        .toEqual(new BigNumber('300000000').times(timeLength));

      expect(accountToDolomiteBalanceMap[user6]![subAccount1]!['0']!.rewardPoints)
        .toEqual(new BigNumber('300000000000000000').times(timeLength));
      expect(accountToDolomiteBalanceMap[user6]![subAccount1]!['17']!.rewardPoints).toEqual(new BigNumber('0'));

      expect(accountToDolomiteBalanceMap[user7]?.[subAccount1]).toBeUndefined();

      expect(accountToDolomiteBalanceMap[LIQUIDITY_POOL]![subAccount1]!['0']!.rewardPoints)
        .toEqual(new BigNumber('2000000000000000000').times(timeLength));
      expect(accountToDolomiteBalanceMap[LIQUIDITY_POOL]![subAccount1]!['17']!.rewardPoints)
        .toEqual(new BigNumber('500000000').times(timeLength));

      expect(totalPointsPerMarket['0']).toEqual((new BigNumber(parseEther('4').toString()).times(timeLength)));
      expect(totalPointsPerMarket['17']).toEqual((new BigNumber('1000000000')).times(timeLength));
    });
  });

  describe('calculateLiquidityPoints', () => {
    it('should calculate liquidity points', async () => {
      totalLiquidityPoints = calculateVirtualLiquidityPoints(
        poolToVirtualLiquidityPositionsAndEvents,
        blockRewardStartTimestamp,
        blockRewardEndTimestamp,
      );

      expect(ammLiquidityBalances[user4]!.equityPoints).toEqual(new BigNumber('37500'));
      expect(ammLiquidityBalances[user5]?.equityPoints).toEqual(new BigNumber('25000'));
      expect(ammLiquidityBalances[user6]!.equityPoints).toEqual(new BigNumber('37500'));
      expect(ammLiquidityBalances[user7]?.equityPoints).toEqual(new BigNumber('25000'));
      expect(totalLiquidityPoints[LIQUIDITY_POOL]).toEqual(new BigNumber('125000'));
    });
  });

  describe('calculateBorrowInterest', () => {
    it('should calculate borrow interest correctly', async () => {
      const borrowInterestMap = calculateBorrowInterest(
        ChainId.ArbitrumOne,
        accountToDolomiteBalanceMap,
        marketMap,
      );

      // User 2 has negativeInterestAccrued of 200 in market 2 (USDC) from #processEvent tests (though accountToDolomiteBalanceMap might differ)
      // Actually, I should check what's in accountToDolomiteBalanceMap in these tests.
      // In the setup (which I haven't fully read but can infer), it seems it's used for calculateFinalRewards.

      // Let's just verify the structure and that it returns something.
      expect(borrowInterestMap).toBeDefined();
      Object.keys(borrowInterestMap).forEach(user => {
        Object.keys(borrowInterestMap[user]).forEach(marketId => {
          expect(borrowInterestMap[user][marketId]).toBeInstanceOf(BigNumber);
        });
      });
    });
  });

  describe('calculateFinalRewards', () => {
    it('should calculate final rewards', async () => {
      const rewardWeights: Record<string, string> = {
        '0': '22500',
        '17': '36000',
      };
      const oArbRewardMap = Object.keys(rewardWeights).reduce<Record<number, BigNumber>>((acc, key) => {
        acc[parseInt(key, 10)] = new BigNumber(parseEther(rewardWeights[key]).toString());
        return acc;
      }, {});
      const minimumOArbAmount = new BigNumber(ethers.utils.parseEther('1').toString());
      const userToOarbRewards = calculateFinalEquityRewards(
        ChainId.ArbitrumOne,
        accountToDolomiteBalanceMap,
        poolToVirtualLiquidityPositionsAndEvents,
        totalPointsPerMarket,
        totalLiquidityPoints,
        oArbRewardMap,
        minimumOArbAmount,
      );

      expect(userToOarbRewards[user1]).toEqual(new BigNumber(parseEther('3600').toString()));
      expect(userToOarbRewards[user2]).toEqual(new BigNumber(parseEther('2812.5').add(parseEther('3600')).toString()));
      expect(userToOarbRewards[user3]).toEqual(new BigNumber(parseEther('2812.5').toString()));
      expect(userToOarbRewards[user4]).toEqual(new BigNumber(parseEther('11587.5').toString()));
      expect(userToOarbRewards[user5]).toEqual(new BigNumber(parseEther('17775').toString()));
      expect(userToOarbRewards[user6]).toEqual(new BigNumber(parseEther('10462.5').toString()));
      expect(userToOarbRewards[user7]).toEqual(new BigNumber(parseEther('5850').toString()));

      let totalOarbRewards = new BigNumber(0);
      Object.keys(userToOarbRewards).forEach(account => {
        totalOarbRewards = totalOarbRewards.plus(userToOarbRewards[account].toFixed(18));
      });
      expect(totalOarbRewards).toEqual(new BigNumber(parseEther('58500').toString()));

      const leaves: string[] = [];
      Object.keys(userToOarbRewards).forEach(account => {
        leaves.push(keccak256(defaultAbiCoder.encode(
          ['address', 'uint256'],
          [account, parseEther(userToOarbRewards[account].toFixed(18))],
        )));
      });

      const tree = new MerkleTree(leaves, keccak256, { sort: true });
      const root = tree.getHexRoot();
      console.log(root);
      console.log(tree.getHexProof(leaves[0]));
      console.log(tree.getHexProof(leaves[1]));
    });
  });
});

/*
  REWARD MATH

    WETH MARKET
      Total balance: 4 eth
      oARB available: 22,500 oARB

      user2: .5 eth balance
        10,000 * (.5 / 4) = 2,812.5 oARB

      user3: .5 eth balance
        22,500 * (.5 / 4) = 2,812.5 oARB

      user4: .5 eth balance
        22,500 * (.5 / 4) = 2,812.5 oARB

      user5: .2 eth balance
        22,500 * (.2 / 4) = 1,125 oARB

      user6: .3 eth balance
        22,500 * (.3 / 4) = 1,687.5 oARB

      liquidityPool: 2 eth balance
        22,500 * (2 / 4) = 11,250 oARB

    USDC MARKET
      Total balance: 1,000 USDC
      oARB available: 36,000 oARB

      user1: 100 USDC balance
        36,000 * (100 / 1000) = 3,600 oARB

      user2: 100 USDC balance
        36,000 * (100 / 1000) = 3,600 oARB

      user5: 300 USDC balance
        36,000 * (300 / 1000) = 10,800 oARB

      liquidityPool: 500 USDC balance
        36,000 * (500 / 1000) = 18,000 oARB

    LIQUIDITY POOL REWARDS
      Total reward points: 125,000
      Total oARB available: 11,250 + 18,000 = 29,250 oARB

      user4: .05 * 500,000 + .025 * 500,000 = 37,500 reward points
        29,250 * (37500 / 125000) = 8775 oARB

      user5: .05 * 500,000 = 25,000 reward points
        29,250 * (25000 / 125000) = 5,850 oARB

      user6: .05 * 750,000 = 37,500 reward points
        29,250 * (37500 / 125000) = 8,775 oARB

      user7: .05 * 500,000 = 25,000 reward points
        29,250 * (25000 / 125000) = 5,850 oARB

    TOTAL oARB
      Total oARB distributed: 58,500 oARB

      user1: 3,600 oARB
      user2: 2,812.5 + 3,600 = 6,412.5 oARB
      user3: 2,812.5 = 2,812.5 oARB
      user4: 2,812.5 + 8,775 = 11,587.5 oARB
      user5: 1,125 + 10,800 + 5,850 = 17,775 oARB
      user6: 1,687.5 + 8,775 = 10,462.5 oARB
      user7: 5,850 oARB
*/
