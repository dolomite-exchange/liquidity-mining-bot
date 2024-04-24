import { fulfillLevelUpdateRequest } from '../helpers/dolomite-helpers';
import BlockStore from './block-store';
import { delay } from './delay';
import LevelUpdateRequestCache from './level-update-request-cache';
import LevelUpdateRequestStore from './level-update-request-store';
import Logger from './logger';

const WAIT_DURATION = 1_000;

export default class DolomiteLevelRequestUpdater {
  public levelUpdateRequestStore: LevelUpdateRequestStore;
  public levelUpdateRequestCache: LevelUpdateRequestCache;
  public blockStore: BlockStore;

  constructor(
    levelUpdateRequestStore: LevelUpdateRequestStore,
    levelUpdateRequestCache: LevelUpdateRequestCache,
    blockStore: BlockStore,
  ) {
    this.levelUpdateRequestStore = levelUpdateRequestStore;
    this.levelUpdateRequestCache = levelUpdateRequestCache;
    this.blockStore = blockStore;
  }

  start = () => {
    Logger.info({
      at: 'DolomiteLevelRequestUpdater#start',
      message: 'Starting DolomiteMargin request updater',
    });
    delay(Number(WAIT_DURATION))
      .then(() => this._poll())
      .catch(() => this._poll());
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      await this._fulfillLevelUpdateRequests();

      await delay(Number(WAIT_DURATION));
    }
  };

  _fulfillLevelUpdateRequests = async () => {
    const lastBlockTimestamp = this.blockStore.getBlockTimestamp();
    if (lastBlockTimestamp === 0) {
      Logger.info({
        at: 'DolomiteLevelRequestUpdater#_fulfillLevelUpdateRequests',
        message: 'Block timestamp is not set yet, returning...',
      });
      return;
    }

    const requests = this.levelUpdateRequestStore.getLevelUpdateRequests()
      .filter(p => !this.levelUpdateRequestCache.contains(p));

    const truncatedTime = Math.floor(Date.now() / 1_000);
    if (requests.length === 0) {
      if (truncatedTime % 10 === 0) {
        Logger.info({
          at: 'DolomiteLevelRequestUpdater#_fulfillLevelUpdateRequests',
          message: 'No accounts to level up',
        });
      }
      return;
    }

    requests.forEach(a => this.levelUpdateRequestCache.add(a));

    for (let i = 0; i < requests.length; i += 1) {
      const request = requests[i];
      try {
        await fulfillLevelUpdateRequest(request);
        await delay(Number(process.env.SEQUENTIAL_TRANSACTION_DELAY_MS));
      } catch (error: any) {
        Logger.error({
          at: 'DolomiteLevelRequestUpdater#_fulfillLevelUpdateRequests',
          message: `Failed to fulfill level update: ${error.message}`,
          request,
          error,
        });
      }
    }
  };
}
