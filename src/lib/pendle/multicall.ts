import sleep from '@dolomite-exchange/zap-sdk/dist/__tests__/helpers/sleep';
import { BigNumber, utils } from 'ethers';
import { dolomite } from '../../helpers/web3';
import * as constants from './consts';
import { YTInterestData } from './types';

const RETRY_ATTEMPTS = 5;
const SLEEP_DURATION_BETWEEN_BATCHES_MS = 1_000; // 1,000 ms

export async function aggregateMultiCall(
  callDatas: { target: string; callData: string }[],
  blockNumber: number,
) {
  const result: any[] = [];
  for (
    let start = 0;
    start < callDatas.length;
    start += constants.MULTICALL_BATCH_SIZE
  ) {
    const resp = await doCall(callDatas, start, blockNumber);
    result.push(...resp);
    if (start + constants.MULTICALL_BATCH_SIZE < callDatas.length) {
      await sleep(SLEEP_DURATION_BETWEEN_BATCHES_MS);
    }
  }
  return result;
}

async function doCall(
  callDatas: { target: string, callData: string }[],
  start: number,
  blockNumber: number,
  retry: number = 0,
  mostRecentError?: Error,
): Promise<string[]> {
  if (retry === RETRY_ATTEMPTS) {
    return Promise.reject(
      new Error(
        `Could not do call after ${retry} attempts due to error at block ${blockNumber}: ${mostRecentError?.message}`,
      ),
    );
  }
  try {
    return (
      await dolomite.multiCall.aggregate(
        callDatas.slice(start, start + constants.MULTICALL_BATCH_SIZE),
        { blockNumber },
      )
    ).results;
  } catch (error: any) {
    // await sleep(((retry + 1) ** 2) * 1_000);
    await sleep((retry + 1) * 1_000);
    return doCall(
      callDatas,
      start,
      blockNumber,
      retry + 1,
      error,
    );
  }
}

export async function getAllERC20Balances(
  token: string,
  addresses: string[],
  blockNumber: number,
): Promise<BigNumber[]> {
  const callDatas = addresses.map((address) => ({
    target: token,
    callData: constants.Contracts.marketInterface.encodeFunctionData(
      'balanceOf',
      [address],
    ),
  }));
  const balances = await aggregateMultiCall(callDatas, blockNumber);
  return balances.map((b) => BigNumber.from(utils.defaultAbiCoder.decode(['uint256'], b)[0]));
}

export async function getAllMarketActiveBalances(
  market: string,
  addresses: string[],
  blockNumber: number,
): Promise<BigNumber[]> {
  const callDatas = addresses.map((address) => ({
    target: market,
    callData: constants.Contracts.marketInterface.encodeFunctionData(
      'activeBalance',
      [address],
    ),
  }));
  const balances = await aggregateMultiCall(callDatas, blockNumber);
  return balances.map((b) => BigNumber.from(utils.defaultAbiCoder.decode(['uint256'], b)[0]));
}

export async function getAllYTInterestData(
  yt: string,
  addresses: string[],
  blockNumber: number,
): Promise<YTInterestData[]> {
  const callDatas = addresses.map((address) => ({
    target: yt,
    callData: constants.Contracts.yieldTokenInterface.encodeFunctionData(
      'userInterest',
      [address],
    ),
  }));
  const interests = await aggregateMultiCall(callDatas, blockNumber);
  return interests.map((b) => {
    const rawData = utils.defaultAbiCoder.decode(['uint128', 'uint128'], b);
    return {
      index: BigNumber.from(rawData[0]),
      accrue: BigNumber.from(rawData[1]),
    };
  });
}
