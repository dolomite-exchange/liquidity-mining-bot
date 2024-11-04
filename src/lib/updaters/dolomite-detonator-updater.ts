import { detonateAccount } from '../../helpers/dolomite-helpers';
import BlockStore from '../stores/block-store';
import { delay } from '../delay';
import Logger from '../logger';
import VestingPositionCache from '../caches/vesting-position-cache';
import VestingPositionStore from '../stores/vesting-position-store';

const WAIT_DURATION = 5_000;

export const DETONATION_WINDOW_SECONDS = 86_400 * 7 * 4; // 4 weeks

export default class DolomiteDetonatorUpdater {
  public vestingPositionStore: VestingPositionStore;
  public vestingPositionCache: VestingPositionCache;
  public blockStore: BlockStore;

  constructor(
    vestingPositionStore: VestingPositionStore,
    vestingPositionCache: VestingPositionCache,
    blockStore: BlockStore,
  ) {
    this.vestingPositionStore = vestingPositionStore;
    this.vestingPositionCache = vestingPositionCache;
    this.blockStore = blockStore;
  }

  start = () => {
    Logger.info({
      at: 'DolomiteDetonator#start',
      message: 'Starting DolomiteMargin detonator',
    });
    delay(Number(WAIT_DURATION))
      .then(() => this._poll())
      .catch(() => this._poll());
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      await this._detonateAccounts();

      await delay(Number(WAIT_DURATION));
    }
  };

  _detonateAccounts = async () => {
    const lastBlockTimestamp = this.blockStore.getBlockTimestamp();
    if (lastBlockTimestamp === 0) {
      Logger.info({
        at: 'DolomiteDetonator#_detonateAccounts',
        message: 'Block timestamp is not set yet, returning...',
      });
      return;
    }

    const explodablePositions = this.vestingPositionStore.getExplodablePositions()
      .filter(p => !this.vestingPositionCache.contains(p));

    const truncatedTime = Math.floor(Date.now() / 1_000);
    if (explodablePositions.length === 0) {
      if (truncatedTime % 10 === 0) {
        Logger.info({
          at: 'DolomiteDetonator#_detonateAccounts',
          message: 'No accounts to detonate',
        });
      }
      return;
    }

    explodablePositions.forEach(a => this.vestingPositionCache.add(a));

    for (let i = 0; i < explodablePositions.length; i += 1) {
      const position = explodablePositions[i];
      try {
        await detonateAccount(position, lastBlockTimestamp, DETONATION_WINDOW_SECONDS);
        await delay(Number(process.env.SEQUENTIAL_TRANSACTION_DELAY_MS));
      } catch (error: any) {
        Logger.error({
          at: 'DolomiteDetonator#_detonateAccounts',
          message: `Failed to detonate account: ${error.message}`,
          position,
          error,
        });
      }
    }
  };
}
