import { BigNumber, Integer } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';

const ONE_DAY_SECONDS = 86_400;

export function chunkArray<T>(items: T[], maxChunkSize: number): T[][] {
  if (maxChunkSize < 1) throw new Error('maxChunkSize must be gte 1')
  if (items.length <= maxChunkSize) return [items]

  const numChunks: number = Math.ceil(items.length / maxChunkSize)
  const chunkSize = Math.ceil(items.length / numChunks)

  return [...Array(numChunks).keys()].map(ix => items.slice(ix * chunkSize, ix * chunkSize + chunkSize))
}

export function toNextDailyTimestamp(timestamp: number): number {
  return Math.floor(timestamp / ONE_DAY_SECONDS) * ONE_DAY_SECONDS + ONE_DAY_SECONDS
}

export function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function decodeUint256ToBigNumber(bytes: string): Integer {
  return new BigNumber(ethers.utils.defaultAbiCoder.decode(['uint256'], bytes)[0].toString());
}
