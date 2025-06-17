import { BigNumber, Decimal, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import {
  getDeposits,
  getLiquidations,
  getLiquidationsByBorrowedToken,
  getLiquidationsByHeldToken,
  getLiquidityMiningVestingPositions,
  getLiquidityPositions,
  getLiquiditySnapshots,
  getMakerTrades,
  getTakerTrades,
  getTrades,
  getTransfers,
  getVaporizations,
  getVaporizationsByBorrowedToken,
  getVaporizationsByHeldToken,
  getVestingPositionTransfers,
  getWithdrawals,
} from '../../src/clients/dolomite';
import {
  ApiAccount,
  ApiDeposit,
  ApiLiquidation,
  ApiMarginAccount,
  ApiTrade,
  ApiTransfer,
  ApiVaporization,
  ApiWithdrawal,
} from '../../src/lib/api-types';
import { ChainId } from '../../src/lib/chain-id';
import Pageable from '../../src/lib/pageable';
import { getPendleSyAddressToLiquidityPositionAndEventsForOToken } from './pendle-event-parser';
import {
  AccountToSubAccountToMarketToBalanceAndPointsMap,
  AccountToSubAccountToMarketToBalanceChangeMap,
  AccountToVirtualLiquidityBalanceMap,
  AccountToVirtualLiquiditySnapshotsMap,
  ARB_VESTER_PROXY,
  BalanceAndRewardPoints,
  BalanceChangeEvent,
  LiquidityPositionsAndEvents,
  VirtualBalanceAndRewardPoints,
  VirtualLiquidityPosition,
  VirtualLiquiditySnapshotBalance,
  VirtualLiquiditySnapshotDeltaPar,
} from './rewards';

const TEN = new BigNumber(10);

export function getAccountBalancesByMarket(
  accounts: ApiAccount[],
  startTimestamp: number,
  rewardMultipliersMap: Record<string, Decimal>,
): AccountToSubAccountToMarketToBalanceAndPointsMap {
  const accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceAndPointsMap = {};
  accounts.forEach(account => {
    const accountOwner = account.owner;
    const accountNumber = account.number.toString();
    accountToDolomiteBalanceMap[accountOwner] = accountToDolomiteBalanceMap[accountOwner] ?? {};
    accountToDolomiteBalanceMap[accountOwner]![accountNumber]
      = accountToDolomiteBalanceMap[accountOwner]![accountNumber] ?? {};

    Object.values(account.balances).forEach(balance => {
      accountToDolomiteBalanceMap[accountOwner]![accountNumber]![balance.marketId] = new BalanceAndRewardPoints(
        account.effectiveUser,
        balance.marketId,
        rewardMultipliersMap[balance.marketId] ?? INTEGERS.ONE,
        startTimestamp,
        balance.par.dividedBy(TEN.pow(balance.tokenDecimals)), // convert to Decimals from "BigInt" format
      );
    });
  });
  return accountToDolomiteBalanceMap;
}

export async function getBalanceChangingEvents(
  startBlockNumber: number,
  endBlockNumber: number,
  tokenAddress?: string,
): Promise<AccountToSubAccountToMarketToBalanceChangeMap> {
  const accountToSubAccountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap = {};

  const deposits = await Pageable.getPageableValues((async (lastId) => {
    const results = await getDeposits(startBlockNumber, endBlockNumber, lastId, tokenAddress);
    return results.deposits;
  }));
  parseDeposits(accountToSubAccountToAssetToEventsMap, deposits);

  const withdrawals = await Pageable.getPageableValues((async (lastId) => {
    const results = await getWithdrawals(startBlockNumber, endBlockNumber, lastId, tokenAddress);
    return results.withdrawals;
  }));
  parseWithdrawals(accountToSubAccountToAssetToEventsMap, withdrawals);

  const transfers = await Pageable.getPageableValues((async (lastId) => {
    const results = await getTransfers(startBlockNumber, endBlockNumber, lastId, tokenAddress);
    return results.transfers;
  }));
  parseTransfers(accountToSubAccountToAssetToEventsMap, transfers);

  const trades: ApiTrade[] = [];
  if (tokenAddress) {
    trades.push(
      ...await Pageable.getPageableValues((async (lastId) => {
        const results = await getTakerTrades(startBlockNumber, endBlockNumber, lastId, tokenAddress);
        return results.trades;
      })),
    );
    trades.push(
      ...await Pageable.getPageableValues((async (lastId) => {
        const results = await getMakerTrades(startBlockNumber, endBlockNumber, lastId, tokenAddress);
        return results.trades;
      })),
    );
  } else {
    trades.push(
      ...await Pageable.getPageableValues((async (lastId) => {
        const results = await getTrades(startBlockNumber, endBlockNumber, lastId);
        return results.trades;
      })),
    );
  }
  parseTrades(accountToSubAccountToAssetToEventsMap, trades);

  const liquidations: ApiLiquidation[] = [];
  if (tokenAddress) {
    liquidations.push(
      ...await Pageable.getPageableValues((async (lastId) => {
        const results = await getLiquidationsByHeldToken(startBlockNumber, endBlockNumber, lastId, tokenAddress);
        return results.liquidations;
      })),
    );
    liquidations.push(
      ...await Pageable.getPageableValues((async (lastId) => {
        const results = await getLiquidationsByBorrowedToken(startBlockNumber, endBlockNumber, lastId, tokenAddress);
        return results.liquidations;
      })),
    );
  } else {
    liquidations.push(
      ...await Pageable.getPageableValues((async (lastId) => {
        const results = await getLiquidations(startBlockNumber, endBlockNumber, lastId);
        return results.liquidations;
      })),
    );
  }
  parseLiquidations(accountToSubAccountToAssetToEventsMap, liquidations);

  const vaporizations: ApiVaporization[] = [];
  if (tokenAddress) {
    vaporizations.push(
      ...await Pageable.getPageableValues((async (lastId) => {
        const results = await getVaporizationsByHeldToken(startBlockNumber, endBlockNumber, lastId, tokenAddress);
        return results.vaporizations;
      })),
    );
    vaporizations.push(
      ...await Pageable.getPageableValues((async (lastId) => {
        const results = await getVaporizationsByBorrowedToken(startBlockNumber, endBlockNumber, lastId, tokenAddress);
        return results.vaporizations;
      })),
    );
  } else {
    vaporizations.push(
      ...await Pageable.getPageableValues((async (lastId) => {
        const results = await getVaporizations(startBlockNumber, endBlockNumber, lastId);
        return results.vaporizations;
      })),
    );
  }
  parseVaporizations(accountToSubAccountToAssetToEventsMap, vaporizations);

  Object.keys(accountToSubAccountToAssetToEventsMap).forEach(account => {
    Object.keys(accountToSubAccountToAssetToEventsMap[account]!).forEach(subAccount => {
      Object.keys(accountToSubAccountToAssetToEventsMap[account]![subAccount]!).forEach(asset => {
        accountToSubAccountToAssetToEventsMap[account]![subAccount]![asset]!.sort((a, b) => a.serialId - b.serialId);
      });
    });
  });

  return accountToSubAccountToAssetToEventsMap;
}

type VirtualLiquiditySnapshotInternal = VirtualLiquiditySnapshotBalance | VirtualLiquiditySnapshotDeltaPar;

export async function getPoolAddressToVirtualLiquidityPositionsAndEvents(
  networkId: number,
  startBlockNumber: number,
  startTimestamp: number,
  endTimestamp: number,
  ignorePendle: boolean,
): Promise<Record<string, LiquidityPositionsAndEvents>> {
  const pairToAmmPositionsAndEventsMap = await getAmmLiquidityPositionAndEvents(
    startBlockNumber,
    startTimestamp,
    endTimestamp,
  );

  const oTokenVestingPositionsAndEventsMap = await getOTokenVestingLiquidityPositionAndEvents(
    startBlockNumber,
    startTimestamp,
    endTimestamp,
  );

  let syAddressToPendlePositionsAndEventsMap: Record<string, LiquidityPositionsAndEvents>;
  if (ignorePendle) {
    syAddressToPendlePositionsAndEventsMap = {};
  } else {
    syAddressToPendlePositionsAndEventsMap = await getPendleSyAddressToLiquidityPositionAndEventsForOToken(
      networkId,
      startTimestamp,
      endTimestamp,
    );
  }

  const arbVesterData = networkId === ChainId.ArbitrumOne
    ? { [ARB_VESTER_PROXY]: oTokenVestingPositionsAndEventsMap }
    : {};

  return {
    ...syAddressToPendlePositionsAndEventsMap,
    ...pairToAmmPositionsAndEventsMap,
    ...arbVesterData,
  };
}

async function getAmmLiquidityPositionAndEvents(
  startBlockNumber: number,
  startTimestamp: number,
  endTimestamp: number,
): Promise<Record<string, LiquidityPositionsAndEvents>> {
  const pairToFinalPositionsAndEventsMap: Record<string, LiquidityPositionsAndEvents> = {};
  const pairToVirtualPositions: Record<string, VirtualLiquidityPosition[]> = {};
  const pairToSnapshots: Record<string, VirtualLiquiditySnapshotInternal[]> = {};
  await Pageable.getPageableValues((async (lastId) => {
    const results = await getLiquidityPositions(startBlockNumber - 1, lastId);
    return results.ammLiquidityPositions.map(position => {
      if (!pairToVirtualPositions[position.pairAddress]) {
        pairToVirtualPositions[position.pairAddress] = [];
      }
      if (!pairToFinalPositionsAndEventsMap[position.pairAddress]) {
        pairToFinalPositionsAndEventsMap[position.pairAddress] = {
          userToLiquiditySnapshots: {},
          virtualLiquidityBalances: {},
        };
      }

      const virtualPosition = {
        id: position.id,
        effectiveUser: position.effectiveUser,
        marketId: -1,
        balancePar: position.balance,
      };
      pairToVirtualPositions[position.pairAddress].push(virtualPosition);
      return virtualPosition;
    });
  }));

  Object.keys(pairToVirtualPositions).forEach(pairAddress => {
    parseVirtualLiquidityPositions(
      pairToFinalPositionsAndEventsMap[pairAddress].virtualLiquidityBalances,
      pairToVirtualPositions[pairAddress],
      startTimestamp,
    );
  });

  await Pageable.getPageableValues<VirtualLiquiditySnapshotInternal>((async (lastId) => {
    const { snapshots } = await getLiquiditySnapshots(startTimestamp, endTimestamp, lastId);
    return snapshots.map<VirtualLiquiditySnapshotInternal>(snapshot => {
      if (!pairToSnapshots[snapshot.pairAddress]) {
        pairToSnapshots[snapshot.pairAddress] = [];
      }
      if (!pairToFinalPositionsAndEventsMap[snapshot.pairAddress]) {
        pairToFinalPositionsAndEventsMap[snapshot.pairAddress] = {
          userToLiquiditySnapshots: {},
          virtualLiquidityBalances: {},
        };
      }

      const virtualSnapshot: VirtualLiquiditySnapshotInternal = {
        id: snapshot.id,
        effectiveUser: snapshot.effectiveUser,
        timestamp: parseInt(snapshot.timestamp, 10),
        balancePar: new BigNumber(snapshot.liquidityTokenBalance),
      };
      pairToSnapshots[snapshot.pairAddress].push(virtualSnapshot);
      return virtualSnapshot;
    });
  }));

  Object.keys(pairToSnapshots).forEach(pairAddress => {
    parseVirtualLiquiditySnapshots(
      pairToFinalPositionsAndEventsMap[pairAddress].userToLiquiditySnapshots,
      pairToSnapshots[pairAddress],
      pairToFinalPositionsAndEventsMap[pairAddress].virtualLiquidityBalances,
    );
  });

  return pairToFinalPositionsAndEventsMap;
}

async function getOTokenVestingLiquidityPositionAndEvents(
  startBlockNumber: number,
  startTimestamp: number,
  endTimestamp: number,
): Promise<LiquidityPositionsAndEvents> {
  const virtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap = {};
  const userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap = {};
  const vestingPositions = await Pageable.getPageableValues<VirtualLiquidityPosition>((async (lastId) => {
    const results = await getLiquidityMiningVestingPositions(startBlockNumber - 1, lastId);
    return results.liquidityMiningVestingPositions.map<VirtualLiquidityPosition>(position => ({
      id: position.id,
      effectiveUser: position.effectiveUser,
      marketId: position.marketId,
      balancePar: position.amountPar,
    }));
  }));
  parseVirtualLiquidityPositions(
    virtualLiquidityBalances,
    vestingPositions,
    startTimestamp,
  );

  const vestingPositionSnapshots = await Pageable.getPageableValues<VirtualLiquiditySnapshotInternal>(
    (async (lastId) => {
      const { vestingPositionTransfers } = await getVestingPositionTransfers(
        startTimestamp,
        endTimestamp,
        lastId,
      );
      return vestingPositionTransfers.reduce<VirtualLiquiditySnapshotInternal[]>((acc, transfer) => {
        let transfers: VirtualLiquiditySnapshotInternal[] = [];
        if (transfer.fromEffectiveUser) {
          transfers = transfers.concat({
            id: transfer.id,
            effectiveUser: transfer.fromEffectiveUser,
            timestamp: transfer.timestamp,
            deltaPar: transfer.amount.negated(),
          });
        }
        if (transfer.toEffectiveUser) {
          transfers = transfers.concat({
            id: transfer.id,
            effectiveUser: transfer.toEffectiveUser,
            timestamp: transfer.timestamp,
            deltaPar: transfer.amount,
          });
        }
        return acc.concat(transfers)
      }, []);
    }),
  );
  parseVirtualLiquiditySnapshots(userToLiquiditySnapshots, vestingPositionSnapshots, virtualLiquidityBalances);

  return { virtualLiquidityBalances, userToLiquiditySnapshots };
}

export function parseDeposits(
  accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap,
  deposits: ApiDeposit[],
): void {
  deposits.forEach((deposit) => {
    const event: BalanceChangeEvent = {
      amountDeltaPar: deposit.amountDeltaPar,
      interestIndex: deposit.interestIndex,
      timestamp: deposit.timestamp,
      serialId: deposit.serialId,
      effectiveUser: deposit.effectiveUser,
      marketId: deposit.marketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      deposit.marginAccount,
      deposit.marketId,
      event,
    );
  });
}

export function parseWithdrawals(
  accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap,
  withdrawals: ApiWithdrawal[],
): void {
  withdrawals.forEach(withdrawal => {
    const event: BalanceChangeEvent = {
      amountDeltaPar: withdrawal.amountDeltaPar,
      interestIndex: withdrawal.interestIndex,
      timestamp: withdrawal.timestamp,
      serialId: withdrawal.serialId,
      effectiveUser: withdrawal.effectiveUser,
      marketId: withdrawal.marketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      withdrawal.marginAccount,
      withdrawal.marketId,
      event,
    );
  });
}

export function parseTransfers(
  accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap,
  transfers: ApiTransfer[],
): void {
  transfers.forEach(transfer => {
    const fromEvent: BalanceChangeEvent = {
      amountDeltaPar: transfer.fromAmountDeltaPar,
      interestIndex: transfer.interestIndex,
      timestamp: transfer.timestamp,
      serialId: transfer.serialId,
      effectiveUser: transfer.fromEffectiveUser,
      marketId: transfer.marketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      transfer.fromMarginAccount,
      transfer.marketId,
      fromEvent,
    );

    const toEvent: BalanceChangeEvent = {
      amountDeltaPar: transfer.toAmountDeltaPar,
      interestIndex: transfer.interestIndex,
      timestamp: transfer.timestamp,
      serialId: transfer.serialId,
      effectiveUser: transfer.toEffectiveUser,
      marketId: transfer.marketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      transfer.toMarginAccount,
      transfer.marketId,
      toEvent,
    );
  });
}

export function parseTrades(
  accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap,
  trades: ApiTrade[],
): void {
  trades.forEach(trade => {
    accountToAssetToEventsMap[trade.takerEffectiveUser] = accountToAssetToEventsMap[trade.takerEffectiveUser] ?? {};

    // Taker events
    const takerEventMinus: BalanceChangeEvent = {
      amountDeltaPar: trade.takerInputTokenDeltaPar,
      interestIndex: trade.takerInterestIndex,
      timestamp: trade.timestamp,
      serialId: trade.serialId,
      effectiveUser: trade.takerEffectiveUser,
      marketId: trade.takerMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      trade.takerMarginAccount,
      trade.takerMarketId,
      takerEventMinus,
    );
    const takerEventPlus: BalanceChangeEvent = {
      amountDeltaPar: trade.takerOutputTokenDeltaPar,
      interestIndex: trade.makerInterestIndex,
      timestamp: trade.timestamp,
      serialId: trade.serialId,
      effectiveUser: trade.takerEffectiveUser,
      marketId: trade.makerMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      trade.takerMarginAccount,
      trade.makerMarketId,
      takerEventPlus,
    );

    // Add maker events
    if (!trade.makerEffectiveUser || !trade.makerMarginAccount) {
      return;
    }
    const makerEventMinus: BalanceChangeEvent = {
      amountDeltaPar: trade.makerInputTokenDeltaPar,
      interestIndex: trade.makerInterestIndex,
      timestamp: trade.timestamp,
      serialId: trade.serialId,
      effectiveUser: trade.makerEffectiveUser,
      marketId: trade.makerMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      trade.makerMarginAccount,
      trade.makerMarketId,
      makerEventMinus,
    );

    const makerEventPlus: BalanceChangeEvent = {
      amountDeltaPar: trade.makerOutputTokenDeltaPar,
      interestIndex: trade.takerInterestIndex,
      timestamp: trade.timestamp,
      serialId: trade.serialId,
      effectiveUser: trade.makerEffectiveUser,
      marketId: trade.takerMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      trade.makerMarginAccount,
      trade.takerMarketId,
      makerEventPlus,
    );
  });
}

export function parseLiquidations(
  accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap,
  liquidations: ApiLiquidation[],
): void {
  liquidations.forEach(liquidation => {
    const liquidUserCollateralEvent: BalanceChangeEvent = {
      amountDeltaPar: liquidation.liquidHeldTokenAmountDeltaPar,
      interestIndex: liquidation.heldInterestIndex,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      effectiveUser: liquidation.liquidEffectiveUser,
      marketId: liquidation.heldMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      liquidation.liquidMarginAccount,
      liquidation.heldMarketId,
      liquidUserCollateralEvent,
    );

    const liquidUserBorrowedEvent: BalanceChangeEvent = {
      amountDeltaPar: liquidation.liquidBorrowedTokenAmountDeltaPar,
      interestIndex: liquidation.borrowedInterestIndex,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      effectiveUser: liquidation.liquidEffectiveUser,
      marketId: liquidation.borrowedMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      liquidation.liquidMarginAccount,
      liquidation.borrowedMarketId,
      liquidUserBorrowedEvent,
    );

    const solidUserCollateralEvent: BalanceChangeEvent = {
      amountDeltaPar: liquidation.solidHeldTokenAmountDeltaPar,
      interestIndex: liquidation.heldInterestIndex,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      effectiveUser: liquidation.solidEffectiveUser,
      marketId: liquidation.heldMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      liquidation.solidMarginAccount,
      liquidation.heldMarketId,
      solidUserCollateralEvent,
    );

    const solidUserBorrowedEvent: BalanceChangeEvent = {
      amountDeltaPar: liquidation.solidBorrowedTokenAmountDeltaPar,
      interestIndex: liquidation.borrowedInterestIndex,
      timestamp: liquidation.timestamp,
      serialId: liquidation.serialId,
      effectiveUser: liquidation.solidEffectiveUser,
      marketId: liquidation.borrowedMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      liquidation.solidMarginAccount,
      liquidation.borrowedMarketId,
      solidUserBorrowedEvent,
    );
  });
}

export function parseVaporizations(
  accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap,
  vaporizations: ApiVaporization[],
): void {
  vaporizations.forEach(vaporization => {
    const vaporUserBorrowedEvent: BalanceChangeEvent = {
      amountDeltaPar: vaporization.vaporBorrowedTokenAmountDeltaPar,
      interestIndex: vaporization.borrowedInterestIndex,
      timestamp: vaporization.timestamp,
      serialId: vaporization.serialId,
      effectiveUser: vaporization.vaporEffectiveUser,
      marketId: vaporization.borrowedMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      vaporization.vaporMarginAccount,
      vaporization.borrowedMarketId,
      vaporUserBorrowedEvent,
    );

    const solidUserCollateralEvent: BalanceChangeEvent = {
      amountDeltaPar: vaporization.solidHeldTokenAmountDeltaPar,
      interestIndex: vaporization.heldInterestIndex,
      timestamp: vaporization.timestamp,
      serialId: vaporization.serialId,
      effectiveUser: vaporization.solidEffectiveUser,
      marketId: vaporization.heldMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      vaporization.solidMarginAccount,
      vaporization.heldMarketId,
      solidUserCollateralEvent,
    );

    const solidUserBorrowedEvent: BalanceChangeEvent = {
      amountDeltaPar: vaporization.solidBorrowedTokenAmountDeltaPar,
      interestIndex: vaporization.borrowedInterestIndex,
      timestamp: vaporization.timestamp,
      serialId: vaporization.serialId,
      effectiveUser: vaporization.solidEffectiveUser,
      marketId: vaporization.borrowedMarketId,
    };
    addEventToUser(
      accountToAssetToEventsMap,
      vaporization.solidMarginAccount,
      vaporization.borrowedMarketId,
      solidUserBorrowedEvent,
    );
  });
}

export function parseVirtualLiquidityPositions(
  userToVirtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap,
  virtualLiquidityPositions: VirtualLiquidityPosition[],
  blockRewardStartTimestamp: number,
): void {
  virtualLiquidityPositions.forEach(position => {
    if (!userToVirtualLiquidityBalances[position.effectiveUser]) {
      userToVirtualLiquidityBalances[position.effectiveUser] = new VirtualBalanceAndRewardPoints(
        position.effectiveUser,
        blockRewardStartTimestamp,
        position.balancePar,
      );
    } else {
      const balanceStruct = userToVirtualLiquidityBalances[position.effectiveUser]!;
      balanceStruct!.balancePar = balanceStruct.balancePar.plus(position.balancePar);
    }
  });
}

export function parseVirtualLiquiditySnapshots(
  userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap,
  virtualLiquiditySnapshots: VirtualLiquiditySnapshotInternal[],
  virtualLiquidityBalanceMap: AccountToVirtualLiquidityBalanceMap,
): void {
  virtualLiquiditySnapshots.forEach(snapshot => {
    addLiquiditySnapshotToUser(
      userToLiquiditySnapshots,
      snapshot.effectiveUser,
      snapshot,
      virtualLiquidityBalanceMap,
    );
  });
}

function addLiquiditySnapshotToUser(
  userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap,
  user: string,
  liquiditySnapshot: VirtualLiquiditySnapshotInternal,
  virtualLiquidityBalanceMap: AccountToVirtualLiquidityBalanceMap,
): void {
  userToLiquiditySnapshots[user] = userToLiquiditySnapshots[user] ?? [];
  if ('balancePar' in liquiditySnapshot) {
    userToLiquiditySnapshots[user]!.push(liquiditySnapshot);
  } else if ('deltaPar' in liquiditySnapshot) {
    const userSnapshots = userToLiquiditySnapshots[user]!;
    let balanceParBefore: BigNumber;
    if (userSnapshots.length === 0 && virtualLiquidityBalanceMap[user]) {
      balanceParBefore = virtualLiquidityBalanceMap[user]!.balancePar;
    } else if (userSnapshots.length > 0) {
      balanceParBefore = userSnapshots[userSnapshots.length - 1].balancePar;
    } else {
      balanceParBefore = new BigNumber(0);
    }

    userToLiquiditySnapshots[user]!.push({
      id: liquiditySnapshot.id,
      effectiveUser: liquiditySnapshot.effectiveUser,
      timestamp: liquiditySnapshot.timestamp,
      balancePar: balanceParBefore.plus(liquiditySnapshot.deltaPar),
    });
  } else {
    throw new Error(`Invalid liquidity snapshot: ${JSON.stringify(liquiditySnapshot)}`);
  }
}

function addEventToUser(
  accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap,
  marginAccount: ApiMarginAccount,
  marketId: number,
  event: BalanceChangeEvent,
): void {
  const { user, accountNumber } = marginAccount;
  accountToAssetToEventsMap[user] = accountToAssetToEventsMap[user] ?? {};
  accountToAssetToEventsMap[user]![accountNumber] = accountToAssetToEventsMap[user]![accountNumber] ?? {};
  if (accountToAssetToEventsMap[user]![accountNumber]![marketId]) {
    accountToAssetToEventsMap[user]![accountNumber]![marketId]!.push(event);
  } else {
    accountToAssetToEventsMap[user]![accountNumber]![marketId] = [event];
  }
}
