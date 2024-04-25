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
  ApiWithdrawal,
} from '../../src/lib/api-types';
import Pageable from '../../src/lib/pageable';
import {
  AccountToSubAccountToMarketToBalanceChangeMap,
  AccountToSubAccountToMarketToBalanceMap,
  AccountToVirtualLiquidityBalanceMap,
  AccountToVirtualLiquiditySnapshotsMap,
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
): AccountToSubAccountToMarketToBalanceMap {
  const accountToDolomiteBalanceMap: AccountToSubAccountToMarketToBalanceMap = {};
  accounts.forEach(account => {
    const accountOwner = account.owner;
    const accountNumber = account.number.toString();
    accountToDolomiteBalanceMap[accountOwner] = accountToDolomiteBalanceMap[accountOwner] ?? {};
    accountToDolomiteBalanceMap[accountOwner]![accountNumber]
      = accountToDolomiteBalanceMap[accountOwner]![accountNumber] ?? {};

    Object.values(account.balances).forEach(balance => {
      accountToDolomiteBalanceMap[accountOwner]![accountNumber]![balance.marketId] = new BalanceAndRewardPoints(
        account.effectiveUser,
        rewardMultipliersMap[balance.marketId] ?? INTEGERS.ONE,
        balance.marketId,
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
  const accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap = {};

  const deposits = await Pageable.getPageableValues((async (lastId) => {
    const results = await getDeposits(startBlockNumber, endBlockNumber, lastId, tokenAddress);
    return results.deposits;
  }));
  parseDeposits(accountToAssetToEventsMap, deposits);

  const withdrawals = await Pageable.getPageableValues((async (lastId) => {
    const results = await getWithdrawals(startBlockNumber, endBlockNumber, lastId, tokenAddress);
    return results.withdrawals;
  }));
  parseWithdrawals(accountToAssetToEventsMap, withdrawals);

  const transfers = await Pageable.getPageableValues((async (lastId) => {
    const results = await getTransfers(startBlockNumber, endBlockNumber, lastId, tokenAddress);
    return results.transfers;
  }));
  parseTransfers(accountToAssetToEventsMap, transfers);

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
  parseTrades(accountToAssetToEventsMap, trades);

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
  parseLiquidations(accountToAssetToEventsMap, liquidations);

  return accountToAssetToEventsMap;
}

type VirtualLiquiditySnapshotInternal = VirtualLiquiditySnapshotBalance | VirtualLiquiditySnapshotDeltaPar;

export async function getAmmLiquidityPositionAndEvents(
  startBlockNumber: number,
  startTimestamp: number,
  endTimestamp: number,
): Promise<LiquidityPositionsAndEvents> {
  const virtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap = {};
  const userToLiquiditySnapshots: AccountToVirtualLiquiditySnapshotsMap = {};
  const virtualLiquidityPositions = await Pageable.getPageableValues<VirtualLiquidityPosition>((async (lastId) => {
    const results = await getLiquidityPositions(startBlockNumber - 1, lastId);
    return results.ammLiquidityPositions.map<VirtualLiquidityPosition>(position => ({
      id: position.id,
      effectiveUser: position.effectiveUser,
      marketId: -1,
      balancePar: position.balance,
    }));
  }));
  parseVirtualLiquidityPositions(
    virtualLiquidityBalances,
    virtualLiquidityPositions,
    startTimestamp,
  );

  const ammLiquiditySnapshots = await Pageable.getPageableValues<VirtualLiquiditySnapshotInternal>((async (lastId) => {
    const { snapshots } = await getLiquiditySnapshots(startTimestamp, endTimestamp, lastId);
    return snapshots.map<VirtualLiquiditySnapshotInternal>(snapshot => ({
      id: snapshot.id,
      effectiveUser: snapshot.effectiveUser,
      timestamp: parseInt(snapshot.timestamp, 10),
      balancePar: new BigNumber(snapshot.liquidityTokenBalance),
    }));
  }));
  parseVirtualLiquiditySnapshots(userToLiquiditySnapshots, ammLiquiditySnapshots, virtualLiquidityBalances);

  return { virtualLiquidityBalances, userToLiquiditySnapshots };
}

export async function getArbVestingLiquidityPositionAndEvents(
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
    };
    addEventToUser(
      accountToAssetToEventsMap,
      liquidation.solidMarginAccount,
      liquidation.borrowedMarketId,
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
        new BigNumber(position.balancePar),
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
  const user = marginAccount.user;
  const accountNumber = marginAccount.accountNumber;
  accountToAssetToEventsMap[user] = accountToAssetToEventsMap[user] ?? {};
  accountToAssetToEventsMap[user]![accountNumber] = accountToAssetToEventsMap[user]![accountNumber] ?? {};
  if (accountToAssetToEventsMap[user]![accountNumber]![marketId]) {
    accountToAssetToEventsMap[user]![accountNumber]![marketId]!.push(event);
  } else {
    accountToAssetToEventsMap[user]![accountNumber]![marketId] = [event];
  }
}
