import { calculateMineralPendleRewards } from '../../../scripts/calculate-mineral-rewards-for-pendle';
import { calculateMineralSeasonConfig, MineralConfigType } from '../../../scripts/calculate-mineral-season-config';
import { delay } from '../delay';
import Logger from '../logger';

const WAIT_DURATION_MILLIS = 60 * 60 * 1_000; // 1 hour in millis
const SHORT_WAIT_DURATION_MILLIS = 60 * 1_000; // 1 minute in millis

export default class PendleMineralsUpdater {
  start = () => {
    Logger.info({
      at: 'PendleMineralsUpdater#start',
      message: 'Starting Pendle Minerals updater',
    });
    this._updatePendleMinerals();
  }

  _updatePendleMinerals = async () => {
    const currentTimestamp = Math.floor(new Date().getTime() / 1_000);
    const timestampNormalized = Math.floor(currentTimestamp / 3_600) * 3_600 + 3_900;
    const deltaSeconds = timestampNormalized - currentTimestamp;

    Logger.info({
      at: 'PendleMineralsUpdater#updatePendleMinerals',
      message: `Sleeping for ${deltaSeconds}s before the first iteration`,
      waitDurationSeconds: deltaSeconds,
    });
    await delay(deltaSeconds * 1_000);

    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        const { epochNumber: epoch } = await calculateMineralSeasonConfig(MineralConfigType.PendleConfig);
        await calculateMineralPendleRewards(epoch);
        await delay(WAIT_DURATION_MILLIS);
      } catch (error: any) {
        Logger.error({
          at: 'PendleMineralsUpdater#updatePendleMinerals',
          message: `Failed to update Pendle Minerals, waiting for ${SHORT_WAIT_DURATION_MILLIS}ms before next run`,
          waitDurationMillis: SHORT_WAIT_DURATION_MILLIS,
          error,
        });
        await delay(SHORT_WAIT_DURATION_MILLIS);
      }
    }
  }
}
