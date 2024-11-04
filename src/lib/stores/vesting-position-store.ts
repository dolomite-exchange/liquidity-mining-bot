import { getExpiredLiquidityMiningVestingPositions } from '../../clients/dolomite';
import { ApiLiquidityMiningVestingPosition } from '../api-types';
import BlockStore from './block-store';
import { delay } from '../delay';
import Logger from '../logger';
import { DETONATION_WINDOW_SECONDS } from '../updaters/dolomite-detonator-updater';

export default class VestingPositionStore {
  public explodablePositions: ApiLiquidityMiningVestingPosition[];
  private blockStore: BlockStore;

  constructor(blockStore: BlockStore) {
    this.explodablePositions = [];
    this.blockStore = blockStore;
  }

  public getExplodablePositions(): ApiLiquidityMiningVestingPosition[] {
    return this.explodablePositions;
  }

  start = () => {
    Logger.info({
      at: 'VestingPositionStore#start',
      message: 'Starting vesting position store',
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
          at: 'VestingPositionStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.ACCOUNT_POLL_INTERVAL_MS));
    }
  };

  _update = async () => {
    Logger.info({
      at: 'VestingPositionStore#_update',
      message: 'Updating vesting positions...',
    });

    const blockNumber = this.blockStore.getBlockNumber();
    const blockTimestamp = this.blockStore.getBlockTimestamp();
    if (blockNumber === 0 || blockTimestamp === 0) {
      Logger.warn({
        at: 'VestingPositionStore#_update',
        message: 'Block number or timestamp is not set yet, returning...',
      });
      return;
    }

    const { liquidityMiningVestingPositions } = await getExpiredLiquidityMiningVestingPositions(
      blockNumber,
      blockTimestamp - DETONATION_WINDOW_SECONDS,
    );

    // don't set the field variables until both values have been retrieved from the network
    this.explodablePositions = liquidityMiningVestingPositions;

    Logger.info({
      at: 'VestingPositionStore#_update',
      message: 'Finished updating vesting positions',
    });
  };
}
