import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { delay } from '../../src/lib/delay';
import LevelUpdateRequestCache from '../../src/lib/level-update-request-cache';

describe('LevelUpdateRequestCache', () => {
  const expirationSeconds = 2;
  process.env.LEVEL_REQUESTS_KEY_EXPIRATION_SECONDS = expirationSeconds.toString();
  const cache = new LevelUpdateRequestCache();

  it('should work', async () => {
    const request1: any = {
      requestId: new BigNumber('1'),
    };
    const request2: any = {
      requestId: new BigNumber('2'),
    };
    cache.add(request1);

    expect(!!cache.contains(request1)).toEqual(true);
    expect(!!cache.contains(request2)).toEqual(false);

    await delay(expirationSeconds * 1000);

    expect(!!cache.contains(request1)).toEqual(false);
    expect(!!cache.contains(request2)).toEqual(false);
  });
});
