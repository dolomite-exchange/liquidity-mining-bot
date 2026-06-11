import { dolomite } from '../../helpers/web3';
import { delay } from '../delay';
import Logger from '../logger';
import { getVeDoloRebateRollingClaimsCurrentEpochNumber } from '../../helpers/vedolo-rebate-helpers';
import { calculateTotalBorrowFeesAggregated } from '../../../scripts/calculate-total-borrow-fees-aggregated';

const WAIT_DURATION_MILLIS = 60 * 1_000; // 60 seconds in millis

export default class BorrowFeeAggregatorUpdater {
  start = () => {
    Logger.info({
      at: 'BorrowFeeAggregatorUpdater#start',
      message: 'Starting borrow fee aggregator updater',
    });
    delay(Number(WAIT_DURATION_MILLIS))
      .then(() => this._poll())
      .catch(() => this._poll());
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
        Logger.info({
          at: 'BorrowFeeAggregatorUpdater#_poll',
          message: `Waiting for ${WAIT_DURATION_MILLIS}ms until next update`,
        })
        await delay(WAIT_DURATION_MILLIS);
      } catch (e: any) {
        Logger.error({
          at: 'BorrowFeeAggregatorUpdater#_poll',
          message: `Could not update aggregate borrow fees due to error: ${e.message}`,
          remediation: `Waiting for ${WAIT_DURATION_MILLIS} before trying again...`,
        })
        await delay(WAIT_DURATION_MILLIS);
      }
    }
  };

  _update = async (): Promise<void> => {
    Logger.info({
      at: 'BorrowFeeAggregatorUpdater#_update',
      message: 'Starting update...',
    });

    const epoch = await getVeDoloRebateRollingClaimsCurrentEpochNumber(dolomite.networkId);
    if (epoch === null || Number.isNaN(epoch)) {
      Logger.info({
        at: 'BorrowFeeAggregatorUpdater#_update',
        message: 'Skipping update due to missing epoch...',
      });
      return;
    }

    try {
      await calculateTotalBorrowFeesAggregated(epoch + 1);
    } catch (e: any) {
      return Promise.reject(e);
    }
  };
}
