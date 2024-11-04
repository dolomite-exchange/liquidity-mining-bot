import { MineralDistributor } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { writeMerkleRootOnChain } from '../../src/helpers/dolomite-helpers';
import { dolomite } from '../../src/helpers/web3';
import { calculateMineralPendleRewards } from '../calculate-mineral-rewards-for-pendle';
import { calculateMineralSeasonConfig, MineralConfigType } from '../calculate-mineral-season-config';
import { getMineralPendleConfigFileNameWithPath, writeMineralPendleConfigToGitHub } from '../lib/config-helper';
import { MineralPendleConfigFile } from '../lib/data-types';
import { readFileFromGitHub } from '../lib/file-helpers';

async function executePendleMineralFlow() {
  const { epochNumber: epoch, isEpochElapsed } = await calculateMineralSeasonConfig(MineralConfigType.PendleConfig);

  let merkleRoot: string | null = null;
  if (isEpochElapsed) {
    const result = await calculateMineralPendleRewards(epoch);
    merkleRoot = result.merkleRoot;
  }

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
}

executePendleMineralFlow()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while running:', error);
    process.exit(1);
  });
