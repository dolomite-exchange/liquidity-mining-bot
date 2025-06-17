import { ethers } from 'ethers';
import { CHAIN, PENDLE_TREASURY_ADDRESS, POOL_INFO } from './configuration';
import * as constants from './consts';
import {
  getAllERC20Balances,
  getAllERC20BalancesWithManualCheck,
  getAllMarketActiveBalances,
  getAllYTInterestData,
} from './multicall';
import { LiquidLockerData } from './pendle-api';
import { UserRecord } from './types';

function increaseUserAmount(
  result: UserRecord,
  user: string,
  amount: ethers.BigNumberish,
) {
  if (result[user]) {
    result[user] = result[user].add(amount);
  } else {
    result[user] = ethers.BigNumber.from(amount);
  }
}

export async function applyYtHolderShares(
  result: UserRecord,
  allUsers: string[],
  marketId: number,
  blockNumber: number,
): Promise<void> {
  const poolConfiguration = POOL_INFO[CHAIN][marketId];

  const balances = (
    await getAllERC20Balances(poolConfiguration.YT, allUsers, blockNumber, poolConfiguration.deployedBlock)
  ).map((v, i) => {
    return {
      user: allUsers[i],
      balance: v,
    };
  });

  const allInterests = (
    await getAllYTInterestData(poolConfiguration.YT, allUsers, blockNumber, poolConfiguration.deployedBlock)
  ).map((v, i) => {
    return {
      user: allUsers[i],
      userIndex: v.index,
      amount: v.accrue,
    };
  });

  const YTIndex = allInterests
    .map((v) => v.userIndex)
    .reduce((a, b) => {
      return a.gt(b) ? a : b;
    });

  const YTBalances: UserRecord = {};

  for (const b of balances) {
    const impliedBalance = constants._1E18.mul(b.balance).div(YTIndex);
    const feeShare = impliedBalance.mul(3).div(100);
    const remaining = impliedBalance.sub(feeShare);
    increaseUserAmount(result, b.user, remaining);
    increaseUserAmount(result, PENDLE_TREASURY_ADDRESS!, feeShare);
    YTBalances[b.user] = b.balance;
  }

  for (const i of allInterests) {
    if (i.user === poolConfiguration.YT) {
      continue;
    }
    if (i.userIndex.eq(0)) {
      continue;
    }

    const pendingInterest = YTBalances[i.user]
      .mul(YTIndex.sub(i.userIndex))
      .mul(constants._1E18)
      .div(YTIndex.mul(i.userIndex));

    const totalInterest = pendingInterest.add(i.amount);
    increaseUserAmount(result, i.user, totalInterest);
  }
}

export async function applyLpHolderShares(
  result: UserRecord,
  lpToken: string,
  allUsers: string[],
  liquidLockers: LiquidLockerData[],
  marketId: number,
  blockNumber: number,
): Promise<void> {
  const poolConfiguration = POOL_INFO[CHAIN][marketId];
  const totalSy = (
    await getAllERC20Balances(poolConfiguration.SY, [lpToken], blockNumber, poolConfiguration.deployedBlock)
  )[0];
  const allActiveBalances = await getAllMarketActiveBalances(
    lpToken,
    allUsers,
    blockNumber,
    poolConfiguration.deployedBlock,
  );
  const totalActiveSupply = allActiveBalances.reduce(
    (a, b) => a.add(b),
    ethers.BigNumber.from(0),
  );

  for (let i = 0; i < allUsers.length; i += 1) {
    const user = allUsers[i];
    const liquidLockerIndex = liquidLockers.findIndex(
      (data) => data.lpHolder.toLowerCase() === user.toLowerCase(),
    );
    const boostedSyBalance = allActiveBalances[i]
      .mul(totalSy)
      .div(totalActiveSupply);


    if (liquidLockerIndex === -1) {
      increaseUserAmount(result, user, boostedSyBalance);
    } else {
      const liquidLocker = liquidLockers[liquidLockerIndex];
      const users = liquidLocker.users;
      const receiptToken = liquidLocker.receiptToken;

      const balances = await getAllERC20BalancesWithManualCheck(receiptToken, users, blockNumber);

      if (!balances) {
        continue;
      }

      const totalReceiptBalance = balances.reduce(
        (a, b) => a.add(b),
        ethers.BigNumber.from(0),
      );

      for (let j = 0; j < users.length; ++j) {
        const user = users[j];
        const receiptBalance = balances[j];

        if (receiptBalance.isZero()) {
          continue;
        }

        const userShare = receiptBalance
          .mul(boostedSyBalance)
          .div(totalReceiptBalance);

        increaseUserAmount(result, user, userShare);
      }
    }
  }
}
