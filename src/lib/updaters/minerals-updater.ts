import { calculateMineralRewards } from '../../../scripts/calculate-mineral-rewards';
import { calculateMineralSeasonConfig, MineralConfigType } from '../../../scripts/calculate-mineral-season-config';
import { delay } from '../delay';
import Logger from '../logger';

const SHORT_WAIT_DURATION_MILLIS = 60 * 1_000; // 60 seconds in millis
const LONG_WAIT_DURATION_MILLIS = 3_540 * 1_000; // 59 minutes in millis
const ONE_WEEK_SECONDS = 86_400 * 7;
const FOUR_MINUTES_SECONDS = 240;

export default class MineralsUpdater {
  private skipConfigUpdate = false;

  start = () => {
    Logger.info({
      at: 'MineralsUpdater#start',
      message: 'Starting minerals updater',
    });
    delay(Number(SHORT_WAIT_DURATION_MILLIS))
      .then(() => this._poll())
      .catch(() => this._poll());
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        const { isEpochElapsed, endTimestamp } = await this._update();
        const delayTimeMillis = this._getDelayTimeMillis(isEpochElapsed, endTimestamp);
        Logger.info({
          at: 'MineralsUpdater#_poll',
          message: `Waiting for ${delayTimeMillis}ms until next update`,
        })
        await delay(delayTimeMillis);
        if (isEpochElapsed) {
          await this._update();
        }
        this.skipConfigUpdate = false;
      } catch (e: any) {
        Logger.error({
          at: 'MineralsUpdater#_poll',
          message: `Could not update minerals due to error: ${e.message}`,
          remediation: `Waiting for ${SHORT_WAIT_DURATION_MILLIS} before trying again...`,
        })
        await delay(SHORT_WAIT_DURATION_MILLIS);
      }
    }
  };

  _update = async (): Promise<{ isEpochElapsed: boolean, endTimestamp: number }> => {
    Logger.info({
      at: 'MineralsUpdater#_update',
      message: 'Starting update...',
    });

    const {
      epochNumber,
      endTimestamp,
      isEpochElapsed,
    } = await calculateMineralSeasonConfig(
      MineralConfigType.RegularConfig,
      { skipConfigUpdate: this.skipConfigUpdate },
    );
    Logger.info({
      at: 'MineralsUpdater#_update',
      message: `Finished updating season config for epoch ${epochNumber}`,
      isEpochElapsed,
    });

    Logger.info({
      at: 'MineralsUpdater#_update',
      message: `Calculating mineral rewards for epoch ${epochNumber}`,
    });
    try {
      await calculateMineralRewards(epochNumber);
      this.skipConfigUpdate = false;
    } catch (e: any) {
      this.skipConfigUpdate = true;
      Logger.error({
        at: 'MineralsUpdater#_update',
        message: `Error calculating mineral rewards: ${e.message}`,
        error: e,
      });
      throw e;
    }

    Logger.info({
      at: 'MineralsUpdater#_update',
      message: `Finished calculating mineral rewards for epoch ${epochNumber}`,
    });

    return { isEpochElapsed, endTimestamp };
  };

  private _getDelayTimeMillis(isEpochElapsed: boolean, endTimestamp: number): number {
    if (isEpochElapsed) {
      // We don't want to wait too long for the next epoch's calculation
      return SHORT_WAIT_DURATION_MILLIS;
    }

    // Add 5 minutes as a buffer to wait for any syncing to occur after seconds
    const currentWeek = Math.floor(endTimestamp / ONE_WEEK_SECONDS) * ONE_WEEK_SECONDS;
    const nextWeek = currentWeek + ONE_WEEK_SECONDS + FOUR_MINUTES_SECONDS;
    const timeDeltaMillis = (nextWeek - endTimestamp) * 1_000;
    return Math.min(timeDeltaMillis, LONG_WAIT_DURATION_MILLIS);
  }
}
