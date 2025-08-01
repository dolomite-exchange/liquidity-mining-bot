import { fulfillLevelUpdateRequest } from '../../helpers/dolomite-helpers';
import BlockStore from '../stores/block-store';
import { delay } from '../delay';
import LevelUpdateRequestCache from '../caches/level-update-request-cache';
import LevelUpdateRequestStore from '../stores/level-update-request-store';
import Logger from '../logger';
import MarketStore from '../stores/market-store';

const WAIT_DURATION = 1_000;

export default class DolomiteLevelRequestUpdater {
  constructor(
    private readonly levelUpdateRequestStore: LevelUpdateRequestStore,
    private readonly levelUpdateRequestCache: LevelUpdateRequestCache,
    private readonly blockStore: BlockStore,
    private readonly marketStore: MarketStore,
  ) {}

  start = () => {
    Logger.info({
      at: 'DolomiteLevelRequestUpdater#start',
      message: 'Starting DolomiteMargin request updater',
    });

    delay(Number(process.env.MARKET_POLL_INTERVAL_MS))
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

    if (requests.length === 0) {
      return;
    }

    const marketMap = this.marketStore.getMarketMap();
    const marketIndexMap = await this.marketStore.getMarketIndexMap(marketMap);

    requests.forEach(a => this.levelUpdateRequestCache.add(a));

    for (let i = 0; i < requests.length; i += 1) {
      const request = requests[i];
      try {
        await fulfillLevelUpdateRequest(request, marketMap, marketIndexMap, this.blockStore.getBlockNumber());
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
