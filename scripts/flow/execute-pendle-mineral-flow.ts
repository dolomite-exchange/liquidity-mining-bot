import { MineralDistributor } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { writeMerkleRootOnChain } from '../../src/helpers/dolomite-helpers';
import { dolomite } from '../../src/helpers/web3';
import { calculateMineralYtRewards } from '../calculate-mineral-rewards-for-yt';
import { calculateMineralSeasonConfig, MineralConfigType } from '../calculate-mineral-season-config';
import { getMineralYtConfigFileNameWithPath, writeMineralYtConfigToGitHub } from '../lib/config-helper';
import { MineralYtConfigFile } from '../lib/data-types';
import { readFileFromGitHub } from '../lib/file-helpers';

async function executePendleMineralFlow() {
  const { epochNumber: epoch, isEpochElapsed } = await calculateMineralSeasonConfig(MineralConfigType.YtConfig);

  let merkleRoot: string | null = null;
  if (isEpochElapsed) {
    const result = await calculateMineralYtRewards(epoch);
    merkleRoot = result.merkleRoot;
  }

  if (merkleRoot) {
    const networkId = dolomite.networkId;
    await writeMerkleRootOnChain(epoch, merkleRoot, MineralDistributor[networkId].address);

    const mineralYtConfigFile = await readFileFromGitHub<MineralYtConfigFile>(
      getMineralYtConfigFileNameWithPath(networkId),
    );
    mineralYtConfigFile.epochs[epoch].isMerkleRootGenerated = true;
    mineralYtConfigFile.epochs[epoch].isMerkleRootWrittenOnChain = true;
    await writeMineralYtConfigToGitHub(mineralYtConfigFile, mineralYtConfigFile.epochs[epoch]);
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
