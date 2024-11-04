import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { CHAIN, POOL_INFO } from './configuration';
import { applyLpHolderShares, applyYtHolderShares } from './logic';
import { PendleAPI } from './pendle-api';
import { UserRecord, UserRecordWithDecimal } from './types';

const TEN = new BigNumber(10);

export async function fetchPendleUserBalanceSnapshotBatch(
  marketId: number,
  blockNumbers: number[],
): Promise<UserRecordWithDecimal[]> {
  const allLiquidLockerTokens = POOL_INFO[CHAIN][marketId].liquidLockers.map(
    (l) => l.receiptToken,
  );
  const allLPTokens = POOL_INFO[CHAIN][marketId].LPs.map((l) => l.address);

  const allYTUsers = await PendleAPI.query(POOL_INFO[CHAIN][marketId].YT);
  const allLPUsers = await PendleAPI.queryAllTokens([
    ...allLPTokens,
    ...allLiquidLockerTokens,
  ]);

  return await Promise.all(
    blockNumbers.map((b) => _fetchUserBalanceSnapshot(marketId, allYTUsers, allLPUsers, b)),
  );
}

async function _fetchUserBalanceSnapshot(
  marketId: number,
  allYTUsers: string[],
  allLPUsers: string[],
  blockNumber: number,
): Promise<UserRecordWithDecimal> {
  const result: UserRecord = {};
  const oneUnit = TEN.pow(POOL_INFO[CHAIN][marketId].decimals);
  await applyYtHolderShares(result, allYTUsers, marketId, blockNumber);
  for (const lp of POOL_INFO[CHAIN][marketId].LPs) {
    if (lp.deployedBlock <= blockNumber) {
      await applyLpHolderShares(result, lp.address, allLPUsers, marketId, blockNumber);
    }
  }
  return Object.keys(result).reduce((memo, key) => {
    memo[key] = new BigNumber(result[key].toString()).div(oneUnit);
    return memo;
  }, {});
}
