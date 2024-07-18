import { MineralDistributor } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { writeMerkleRootOnChain } from '../../src/helpers/dolomite-helpers';
import { dolomite } from '../../src/helpers/web3';
import { calculateMineralYtRewards } from '../calculate-mineral-rewards-for-yt';

async function executeYtFlow() {
  const { epoch, merkleRoot } = await calculateMineralYtRewards();
  if (merkleRoot) {
    await writeMerkleRootOnChain(epoch, merkleRoot, MineralDistributor[dolomite.networkId].address);
  }
}

executeYtFlow()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while running:', error);
    process.exit(1);
  });
