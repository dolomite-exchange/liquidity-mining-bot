import { calculateMineralPendleRewards } from '../../../scripts/calculate-mineral-rewards-for-pendle';
import { calculateMineralSeasonConfig, MineralConfigType } from '../../../scripts/calculate-mineral-season-config';
import { delay } from '../delay';
import Logger from '../logger';

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

    const { durationSeconds } = getDurationToNextTimestamp();
    Logger.info({
      at: 'PendleMineralsUpdater#updatePendleMinerals',
      message: `Sleeping for ${durationSeconds}s before the first iteration`,
      waitDurationSeconds: durationSeconds,
    });
    await delay(durationSeconds * 1_000);

    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        Logger.info({
          at: 'PendleMineralsUpdater#updatePendleMinerals',
          message: 'Starting run...',
        });

        const { epochNumber: epoch } = await calculateMineralSeasonConfig(MineralConfigType.PendleConfig);
        await calculateMineralPendleRewards(epoch);

        const { durationSeconds } = getDurationToNextTimestamp();
        Logger.info({
          at: 'PendleMineralsUpdater#updatePendleMinerals',
          message: `Finished updating Pendle Minerals, waiting ${durationSeconds}s before next run`,
          waitDurationSeconds: durationSeconds,
        });
        await delay(durationSeconds * 1_000);
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

function getDurationToNextTimestamp(): { durationSeconds: number } {
  const currentTimestamp = Math.floor(new Date().getTime() / 1_000);
  const nextTimestamp = Math.floor(currentTimestamp / 3_600) * 3_600 + 3_900;
  return { durationSeconds: nextTimestamp - currentTimestamp };
}
