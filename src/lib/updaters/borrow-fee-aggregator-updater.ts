import { calculateODoloAggregateRewards } from '../../../scripts/calculate-odolo-aggregate-rewards';
import { getODoloCurrentEpochNumber } from '../../helpers/odolo-helpers';
import { delay } from '../delay';
import Logger from '../logger';

const WAIT_DURATION_MILLIS = 60 * 1_000; // 60 seconds in millis

export default class ODoloAggregatorUpdater {

  start = () => {
    Logger.info({
      at: 'ODoloAggregatorUpdater#start',
      message: 'Starting oDOLO aggregator updater',
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
          at: 'ODoloAggregatorUpdater#_poll',
          message: `Waiting for ${WAIT_DURATION_MILLIS}ms until next update`,
        })
        await delay(WAIT_DURATION_MILLIS);
      } catch (e: any) {
        Logger.error({
          at: 'ODoloAggregatorUpdater#_poll',
          message: `Could not update oDOLO aggregated rewards due to error: ${e.message}`,
          remediation: `Waiting for ${WAIT_DURATION_MILLIS} before trying again...`,
        })
        await delay(WAIT_DURATION_MILLIS);
      }
    }
  };

  _update = async (): Promise<void> => {
    Logger.info({
      at: 'ODoloAggregatorUpdater#_update',
      message: 'Starting update...',
    });

    const epoch = await getODoloCurrentEpochNumber();
    try {
      await calculateODoloAggregateRewards(epoch + 1);
    } catch (e: any) {
      return Promise.reject(e);
    }
  };
}
