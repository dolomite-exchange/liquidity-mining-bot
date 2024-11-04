import { getUnfulfilledLevelUpdateRequests } from '../../clients/dolomite';
import { ApiLiquidityMiningLevelUpdateRequest } from '../api-types';
import BlockStore from './block-store';
import { delay } from '../delay';
import Logger from '../logger';

export default class LevelUpdateRequestStore {
  public levelUpdateRequests: ApiLiquidityMiningLevelUpdateRequest[];
  private blockStore: BlockStore;

  constructor(blockStore: BlockStore) {
    this.levelUpdateRequests = [];
    this.blockStore = blockStore;
  }

  public getLevelUpdateRequests(): ApiLiquidityMiningLevelUpdateRequest[] {
    return this.levelUpdateRequests;
  }

  start = () => {
    Logger.info({
      at: 'LevelUpdateRequestStore#start',
      message: 'Starting level update request store',
    });
    this._poll();
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
      } catch (error: any) {
        Logger.error({
          at: 'LevelUpdateRequestStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.LEVEL_REQUESTS_POLL_INTERVAL_MS));
    }
  };

  _update = async () => {
    const timestamp = Math.floor(Date.now() / 1_000);
    if (timestamp % 10 === 0) {
      Logger.info({
        at: 'LevelUpdateRequestStore#_update',
        message: 'Updating level update requests...',
      });
    }

    const blockNumber = this.blockStore.getBlockNumber();
    if (blockNumber === 0) {
      Logger.warn({
        at: 'LevelUpdateRequestStore#_update',
        message: 'Block number is 0, returning...',
      });
      return;
    }

    const { requests } = await getUnfulfilledLevelUpdateRequests(blockNumber);

    // don't set the field variables until both values have been retrieved from the network
    this.levelUpdateRequests = requests;

    if (timestamp % 10 === 0) {
      Logger.info({
        at: 'LevelUpdateRequestStore#_update',
        message: 'Finished updating level update requests',
      });
    }
  }
}
