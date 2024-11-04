import LRU from 'lru-cache';
import { ApiLiquidityMiningLevelUpdateRequest } from '../api-types';

export default class LevelUpdateRequestCache {
  public store: LRU;

  constructor() {
    this.store = new LRU({
      maxAge: Number(process.env.LEVEL_REQUESTS_KEY_EXPIRATION_SECONDS) * 1000,
    });
  }

  private static _getKey(request: ApiLiquidityMiningLevelUpdateRequest) {
    return request.requestId.toFixed();
  }

  add(request: ApiLiquidityMiningLevelUpdateRequest) {
    if (!request) {
      throw new Error('Must specify request');
    }

    const key = LevelUpdateRequestCache._getKey(request);

    this.store.set(key, true);
  }

  contains(request: ApiLiquidityMiningLevelUpdateRequest) {
    const key = LevelUpdateRequestCache._getKey(request);

    return this.store.get(key);
  }
}
