import LRU from 'lru-cache';
import { ApiLiquidityMiningVestingPosition } from './api-types';

export default class VestingPositionCache {
  public store: LRU;

  constructor() {
    this.store = new LRU({
      maxAge: Number(process.env.DETONATION_KEY_EXPIRATION_SECONDS) * 1000,
    });
  }

  private static _getKey(vestingPosition: ApiLiquidityMiningVestingPosition) {
    return vestingPosition.id.toLowerCase();
  }

  async add(vestingPosition: ApiLiquidityMiningVestingPosition): Promise<void> {
    if (!vestingPosition) {
      throw new Error('Must specify vestingPosition');
    }

    const key = VestingPositionCache._getKey(vestingPosition);

    this.store.set(key, true);
  }

  contains(vestingPosition: ApiLiquidityMiningVestingPosition): boolean {
    const key = VestingPositionCache._getKey(vestingPosition);

    return this.store.get(key);
  }
}
