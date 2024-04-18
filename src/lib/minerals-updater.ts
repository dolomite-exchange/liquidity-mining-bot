import { calculateMineralRewards } from '../../scripts/calculate-mineral-rewards';
import { calculateMineralSeasonConfig } from '../../scripts/calculate-mineral-season-config';
import { delay } from './delay';
import Logger from './logger';

const SHORT_WAIT_DURATION = 30 * 1_000; // 30 seconds in millis
const LONG_WAIT_DURATION = 3_540 * 1_000; // 59 minutes in millis

export default class MineralsUpdater {
  start = () => {
    Logger.info({
      at: 'MineralsUpdater#start',
      message: 'Starting minerals updater',
    });
    delay(Number(SHORT_WAIT_DURATION))
      .then(() => this._poll())
      .catch(() => this._poll());
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
        await delay(LONG_WAIT_DURATION);
      } catch (e) {
        await delay(SHORT_WAIT_DURATION);
      }
    }
  };

  _update = async () => {
    Logger.info({
      at: 'MineralsUpdater#_update',
      message: 'Starting update...',
    });

    const epochNumber = await calculateMineralSeasonConfig();
    Logger.info({
      at: 'MineralsUpdater#_update',
      message: `Finished updating season config for epoch ${epochNumber}`,
    });

    Logger.info({
      at: 'MineralsUpdater#_update',
      message: `Calculating mineral rewards for epoch ${epochNumber}`,
    });
    try {
      await calculateMineralRewards(epochNumber);
    } catch (e: any) {
      Logger.error({
        at: 'MineralsUpdater#_update',
        message: `Error calculating mineral rewards: ${e.message}`,
        e,
      });
      throw e;
    }

    Logger.info({
      at: 'MineralsUpdater#_update',
      message: `Finished calculating mineral rewards for epoch ${epochNumber}`,
    });
  };
}
