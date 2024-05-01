import { calculateEzEthPoints } from '../../scripts/calculate-ez-eth-points';
import { delay } from './delay';
import Logger from './logger';

const SHORT_WAIT_DURATION_MILLIS = 60 * 1_000;
const WAIT_DURATION_MILLIS = 1_800 * 1_000; // 30 minutes in millis
const APPEND_RESULTS = true;

export default class EzPointsUpdater {
  start = () => {
    Logger.info({
      at: 'EzPointsUpdater#start',
      message: 'Starting ez points updater',
    });
    delay(Number(SHORT_WAIT_DURATION_MILLIS))
      .then(() => this._poll())
      .catch(() => this._poll());
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
        await delay(WAIT_DURATION_MILLIS);
      } catch (e: any) {
        Logger.error({
          message: `Could not update ez points due to error: ${e.message}`,
          error: e,
        })
        await delay(SHORT_WAIT_DURATION_MILLIS);
      }
    }
  };

  _update = async () => {
    Logger.info({
      at: 'EzPointsUpdater#_update',
      message: 'Starting update...',
    });

    await calculateEzEthPoints(APPEND_RESULTS);
    Logger.info({
      at: 'EzPointsUpdater#_update',
      message: `Finished updating ez points`,
    });
  };
}
