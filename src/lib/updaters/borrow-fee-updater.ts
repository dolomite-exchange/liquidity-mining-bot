import { delay } from '../delay';
import Logger from '../logger';
import { getVeDoloRebateCurrentEpochNumber } from '../../helpers/vedolo-rebate-helpers';
import { calculateBorrowFeesPerNetwork } from '../../../scripts/calculate-borrow-fees-per-network';

const WAIT_DURATION_MILLIS = 60 * 1_000; // 60 seconds in millis

export default class BorrowFeeUpdater {
  start = () => {
    Logger.info({
      at: 'BorrowFeeUpdater#start',
      message: 'Starting borrow fee updater',
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
          at: 'BorrowFeeUpdater#_poll',
          message: `Waiting for ${WAIT_DURATION_MILLIS}ms until next update`,
        })
        await delay(WAIT_DURATION_MILLIS);
      } catch (e: any) {
        Logger.error({
          at: 'BorrowFeeUpdater#_poll',
          message: `Could not update borrow fees due to error: ${e.message}`,
          remediation: `Waiting for ${WAIT_DURATION_MILLIS} before trying again...`,
        })
        await delay(WAIT_DURATION_MILLIS);
      }
    }
  };

  _update = async (): Promise<void> => {
    Logger.info({
      at: 'BorrowFeeUpdater#_update',
      message: 'Starting update...',
    });

    const epoch = await getVeDoloRebateCurrentEpochNumber();
    try {
      await calculateBorrowFeesPerNetwork(epoch + 1);
    } catch (e: any) {
      return Promise.reject(e);
    }
  };
}
