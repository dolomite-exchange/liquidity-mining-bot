import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { CHAIN, POOL_INFO } from './configuration';
import { applyLpHolderShares, applyYtHolderShares } from './logic';
import { LiquidLockerData, PendleAPI } from './pendle-api';
import { UserRecord, UserRecordWithDecimal } from './types';

const TEN = new BigNumber(10);

export async function fetchPendleUserBalanceSnapshotBatch(
  marketId: number,
  blockNumbers: number[],
): Promise<UserRecordWithDecimal[]> {
  const allLiquidLockers: LiquidLockerData[][] = [];
  for (let market of POOL_INFO[CHAIN][marketId].LPs) {
    allLiquidLockers.push(await PendleAPI.queryLL(CHAIN, market.address));
  }

  const allLPTokens = POOL_INFO[CHAIN][marketId].LPs.map((l) => l.address);

  const allYTUsers = await PendleAPI.query(POOL_INFO[CHAIN][marketId].YT);
  const allLPUsers = await PendleAPI.queryAllTokens([
    ...allLPTokens,
  ]);

  return await Promise.all(
    blockNumbers.map((b) => _fetchUserBalanceSnapshot(marketId, allYTUsers, allLPUsers, allLiquidLockers, b)),
  );
}

async function _fetchUserBalanceSnapshot(
  marketId: number,
  allYTUsers: string[],
  allLPUsers: string[],
  allLiquidLockersPerLp: LiquidLockerData[][],
  blockNumber: number,
): Promise<UserRecordWithDecimal> {
  const result: UserRecord = {};
  const oneUnit = TEN.pow(POOL_INFO[CHAIN][marketId].decimals);
  await applyYtHolderShares(result, allYTUsers, marketId, blockNumber);

  for (let i = 0; i < POOL_INFO[CHAIN][marketId].LPs.length; i += 1) {
    const lp = POOL_INFO[CHAIN][marketId].LPs[i];
    const liquidLockers = allLiquidLockersPerLp[i];
    if (lp.deployedBlock <= blockNumber) {
      await applyLpHolderShares(result, lp.address, allLPUsers, liquidLockers, marketId, blockNumber);
    }
  }
  return Object.keys(result).reduce((memo, key) => {
    memo[key] = new BigNumber(result[key].toString()).div(oneUnit);
    return memo;
  }, {});
}
