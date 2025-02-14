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
