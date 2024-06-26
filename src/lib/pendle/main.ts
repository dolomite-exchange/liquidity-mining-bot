import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { CHAIN, POOL_INFO } from './configuration';
import { applyLpHolderShares, applyYtHolderShares } from './logic';
import { PendleAPI } from './pendle-api';
import { UserRecord, UserRecordWithInteger } from './types';

async function fetchUserBalanceSnapshot(
  marketId: number,
  allYTUsers: string[],
  allLPUsers: string[],
  blockNumber: number
): Promise<UserRecordWithInteger> {
  const result: UserRecord = {};
  await applyYtHolderShares(result, allYTUsers, marketId, blockNumber);
  for (const lp of POOL_INFO[CHAIN][marketId].LPs) {
    if (lp.deployedBlock <= blockNumber) {
      await applyLpHolderShares(result, lp.address, allLPUsers, marketId, blockNumber);
    }
  }
  return Object.keys(result).reduce((memo, key) => {
    memo[key] = new BigNumber(result[key].toString());
    return memo;
  }, {});
}

export async function fetchPendleYtUserBalanceSnapshotBatch(
  marketId: number,
  blockNumbers: number[]
): Promise<UserRecordWithInteger[]> {
  const allLiquidLockerTokens = POOL_INFO[CHAIN][marketId].liquidLockers.map(
    (l) => l.receiptToken
  );
  const allLPTokens = POOL_INFO[CHAIN][marketId].LPs.map((l) => l.address);

  const allYTUsers = await PendleAPI.query(POOL_INFO[CHAIN][marketId].YT);
  const allLPUsers = await PendleAPI.queryAllTokens([
    ...allLPTokens,
    ...allLiquidLockerTokens
  ]);

  return await Promise.all(
    blockNumbers.map((b) => fetchUserBalanceSnapshot(marketId, allYTUsers, allLPUsers, b))
  );
}

async function main(marketId: number = 17, block: number = 220_943_848) {
  const res = (await fetchPendleYtUserBalanceSnapshotBatch(marketId, [block]))[0];

  for (let user in res) {
    if (res[user].eq(0)) continue;
    console.log(user, res[user].toString());
  }
}

main().catch(console.error);
