import { BigNumber, utils } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { getWeb3RequestWithBackoff } from '../../../scripts/lib/web3-helper';
import { dolomite } from '../../helpers/web3';
import * as constants from './consts';
import { YTInterestData } from './types';

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
  }
  return result;
}

async function doCall(
  callDatas: { target: string, callData: string }[],
  start: number,
  blockNumber: number,
): Promise<string[]> {
  return getWeb3RequestWithBackoff(async () => {
    const { results } = await dolomite.multiCall.aggregate(
      callDatas.slice(start, start + constants.MULTICALL_BATCH_SIZE),
      { blockNumber },
    );
    return results;
  });
}

export async function getAllERC20BalancesWithManualCheck(
  token: string,
  addresses: string[],
  blockNumber: number,
): Promise<BigNumber[] | null> {
  const code = await getWeb3RequestWithBackoff(() => dolomite.web3.eth.getCode(token, blockNumber));
  if (code == '0x') {
    return null;
  }

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

export async function getAllERC20Balances(
  token: string,
  addresses: string[],
  blockNumber: number,
  deployedBlockNumber: number,
): Promise<BigNumber[]> {
  if (blockNumber < deployedBlockNumber) {
    const zero = BigNumber.from(0);
    return addresses.map(() => zero);
  }

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
  deployedBlockNumber: number,
): Promise<BigNumber[]> {
  if (blockNumber < deployedBlockNumber) {
    const zero = BigNumber.from(0);
    return addresses.map(() => zero);
  }

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
  deployedBlockNumber: number,
): Promise<YTInterestData[]> {
  if (blockNumber < deployedBlockNumber) {
    const zero = BigNumber.from(0);
    const one = parseEther('1');
    return addresses.map(() => ({
      accrue: zero,
      index: one,
    }));
  }

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
