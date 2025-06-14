import { BigNumber, Decimal, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { getTimestampToBlockNumberMap } from '../../src/clients/dolomite';
import { ChainId } from '../../src/lib/chain-id';
import { ONE_ETH_WEI } from '../../src/lib/constants';
import { POOL_INFO } from '../../src/lib/pendle/configuration';
import { fetchPendleUserBalanceSnapshotBatch } from '../../src/lib/pendle/fetcher';
import { getMineralFinalizedFileNameWithPath, getMineralPendleConfigFileNameWithPath } from './config-helper';
import { MineralPendleConfigFile, MineralPendleOutputFile } from './data-types';
import { parseVirtualLiquidityPositions } from './event-parser';
import { readFileFromGitHub } from './file-helpers';
import { AccountToVirtualLiquidityBalanceMap, LiquidityPositionsAndEvents, VirtualLiquidityPosition } from './rewards';
import Logger from '../../src/lib/logger';

const PENDLE_FETCH_FREQUENCY = 60 * 60; // one hour in seconds

export async function getPendleSyAddressToLiquidityPositionAndEventsForOToken(
  networkId: number,
  startTimestamp: number,
  endTimestamp: number,
): Promise<Record<string, LiquidityPositionsAndEvents>> {
  const duration = endTimestamp - startTimestamp;
  if (duration % PENDLE_FETCH_FREQUENCY !== 0) {
    return Promise.reject(
      new Error(`Invalid duration for getting Pendle events. Expected to be divisible by ${PENDLE_FETCH_FREQUENCY}`),
    );
  }

  Logger.info({
    file: __filename,
    message: 'Getting Pendle data...',
    startTimestamp,
    endTimestamp,
  })
  const numberOfTimestampsToFetch = Math.ceil(duration / PENDLE_FETCH_FREQUENCY);
  const timestamps = Array.from(
    { length: numberOfTimestampsToFetch },
    (_, i) => startTimestamp + (PENDLE_FETCH_FREQUENCY * i),
  );
  const blockNumbers = Object.values(await getTimestampToBlockNumberMap(timestamps));

  const marketIdToPoolInfoMap = POOL_INFO[networkId as ChainId];
  const syAddressToVirtualLiquidityPositions: Record<string, LiquidityPositionsAndEvents> = {};
  for (const marketId of Object.keys(marketIdToPoolInfoMap)) {
    const userToBalanceMapsForBlockNumbers = await fetchPendleUserBalanceSnapshotBatch(
      parseInt(marketId),
      blockNumbers,
    );
    const userToPositionMap: Record<string, VirtualLiquidityPosition> = {};
    for (const userToBalanceMap of userToBalanceMapsForBlockNumbers) {
      for (let [user, balance] of Object.entries(userToBalanceMap)) {
        if (!userToPositionMap[user]) {
          userToPositionMap[user] = {
            id: `PENDLE-${user}-${marketId}`,
            effectiveUser: user,
            marketId: Number(marketId),
            balancePar: INTEGERS.ZERO,
          };
        }

        const amountForFrequency: Decimal = balance.times(PENDLE_FETCH_FREQUENCY).div(duration);
        userToPositionMap[user].balancePar = userToPositionMap[user].balancePar.plus(amountForFrequency);
      }
    }

    const positions = Object.values(userToPositionMap);
    const virtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap = {};
    parseVirtualLiquidityPositions(
      virtualLiquidityBalances,
      positions,
      startTimestamp,
    );

    const syAddress = POOL_INFO[networkId as ChainId][marketId].SY;
    syAddressToVirtualLiquidityPositions[syAddress] = { virtualLiquidityBalances, userToLiquiditySnapshots: {} };
  }

  return syAddressToVirtualLiquidityPositions;
}

// @ts-ignore
async function getPendleSyAddressToLiquidityPositionAndEventsFromGitHub(
  networkId: number,
  startTimestamp: number,
  endTimestamp: number,
): Promise<Record<string, LiquidityPositionsAndEvents>> {
  const virtualLiquidityBalances: AccountToVirtualLiquidityBalanceMap = {};
  const pendleConfig = await readFileFromGitHub<MineralPendleConfigFile>(getMineralPendleConfigFileNameWithPath(
    networkId));
  const epochs = Object.values(pendleConfig.epochs).filter(e => {
    return e.startTimestamp === startTimestamp && e.endTimestamp === endTimestamp;
  });
  if (epochs.length === 0) {
    const message = `Could not find epoch for start_timestamp, end_timestamp: [${startTimestamp}, ${endTimestamp}]`;
    return Promise.reject(new Error(`${message}. Did you mean to ignore this function call?`));
  }

  const syAddressToVirtualLiquidityPositions = {};
  for (const epoch of epochs) {
    const outputFile = await readFileFromGitHub<MineralPendleOutputFile>(
      getMineralFinalizedFileNameWithPath(networkId, epoch.epoch),
    );
    Object.keys(outputFile.metadata.marketIdToRewardMap).forEach(marketId => {
      const positions = Object.keys(outputFile.users).map<VirtualLiquidityPosition>(user => {
        return {
          id: user,
          marketId: parseInt(marketId),
          effectiveUser: user,
          balancePar: new BigNumber(outputFile.users[user].marketIdToAmountMap[marketId]).div(ONE_ETH_WEI),
        };
      });

      parseVirtualLiquidityPositions(
        virtualLiquidityBalances,
        positions,
        startTimestamp,
      );

      const syAddress = POOL_INFO[networkId as ChainId][marketId].SY;
      syAddressToVirtualLiquidityPositions[syAddress] = { virtualLiquidityBalances, userToLiquiditySnapshots: {} };
    });
  }

  return syAddressToVirtualLiquidityPositions;
}
