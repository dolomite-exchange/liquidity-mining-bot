import { delay } from '../delay';
import Logger from '../logger';
import { getVeDoloRebateCurrentEpochNumber } from '../../helpers/vedolo-rebate-helpers';
import { calculateBorrowRebatePerNetwork } from '../../../scripts/calculate-borrow-rebate-per-network';

const WAIT_DURATION_MILLIS = 60 * 1_000; // 60 seconds in millis

export default class BorrowFeeRebateUpdater {
  start = () => {
    Logger.info({
      at: 'BorrowFeeRebateUpdater#start',
      message: 'Starting borrow fee rebate updater',
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
          at: 'BorrowFeeRebateUpdater#_poll',
          message: `Waiting for ${WAIT_DURATION_MILLIS}ms until next update`,
        })
        await delay(WAIT_DURATION_MILLIS);
      } catch (e: any) {
        Logger.error({
          at: 'BorrowFeeRebateUpdater#_poll',
          message: `Could not update borrow fee rebates due to error: ${e.message}`,
          remediation: `Waiting for ${WAIT_DURATION_MILLIS} before trying again...`,
        })
        await delay(WAIT_DURATION_MILLIS);
      }
    }
  };

  _update = async (): Promise<void> => {
    Logger.info({
      at: 'BorrowFeeRebateUpdater#_update',
      message: 'Starting update...',
    });

    const epoch = await getVeDoloRebateCurrentEpochNumber();
    try {
      await calculateBorrowRebatePerNetwork(epoch + 1);
    } catch (e: any) {
      return Promise.reject(e);
    }
  };
}
