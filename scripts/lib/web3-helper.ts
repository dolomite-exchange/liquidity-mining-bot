import sleep from '@dolomite-exchange/zap-sdk/dist/__tests__/helpers/sleep';

const MAX_RETRIES = 100;

export async function getWeb3RequestWithBackoff<T>(
  request: () => Promise<T>,
  sleepDurationMillis: number = 10,
): Promise<T> {
  for (let retryCount = 0; retryCount < MAX_RETRIES; retryCount += 1) {
    try {
      return await request();
    } catch (e: any) {
      if (
        e.message.includes('429')
        || e.message.includes('request limit reached')
        || e.message.includes('call rate limit')
      ) {
        await sleep(Math.min(15_000, sleepDurationMillis * (2 ** retryCount)));
      } else {
        throw new Error(e);
      }
    }
  }
  throw new Error('Request failed after multiple retries');
}
