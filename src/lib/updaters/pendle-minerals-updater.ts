import { MineralDistributor } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { calculateMineralPendleRewards } from '../../../scripts/calculate-mineral-rewards-for-pendle';
import { calculateMineralSeasonConfig, MineralConfigType } from '../../../scripts/calculate-mineral-season-config';
import {
  getMineralPendleConfigFileNameWithPath,
  writeMineralPendleConfigToGitHub,
} from '../../../scripts/lib/config-helper';
import { MineralPendleConfigFile } from '../../../scripts/lib/data-types';
import { readFileFromGitHub } from '../../../scripts/lib/file-helpers';
import { writeMerkleRootOnChain } from '../../helpers/dolomite-helpers';
import { dolomite } from '../../helpers/web3';
import { delay } from '../delay';
import Logger from '../logger';

const WAIT_DURATION_MILLIS = 60 * 1_000; // 60 seconds in millis

export default class PendleMineralsUpdater {
  start = () => {
    Logger.info({
      at: 'PendleMineralsUpdater#start',
      message: 'Starting Pendle Minerals updater',
    });
    this._updatePendleMinerals();
  }

  _updatePendleMinerals = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        const { epochNumber: epoch } = await calculateMineralSeasonConfig(MineralConfigType.PendleConfig);

        const merkleRoot = (await calculateMineralPendleRewards(epoch)).merkleRoot;

        if (merkleRoot) {
          const networkId = dolomite.networkId;
          await writeMerkleRootOnChain(epoch, merkleRoot, MineralDistributor[networkId].address);

          const mineralPendleConfigFile = await readFileFromGitHub<MineralPendleConfigFile>(
            getMineralPendleConfigFileNameWithPath(networkId),
          );
          mineralPendleConfigFile.epochs[epoch].isMerkleRootGenerated = true;
          mineralPendleConfigFile.epochs[epoch].isMerkleRootWrittenOnChain = true;
          await writeMineralPendleConfigToGitHub(mineralPendleConfigFile, mineralPendleConfigFile.epochs[epoch]);
        }
      } catch (error: any) {
        Logger.error({
          at: 'PendleMineralsUpdater#updatePendleMinerals',
          message: 'Failed to update Pendle Minerals',
          error,
        });
      }

      await delay(WAIT_DURATION_MILLIS);
    }
  }
}
