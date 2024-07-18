import { OARBRewardsDistributor } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { writeMerkleRootOnChain } from '../../src/helpers/dolomite-helpers';
import { dolomite } from '../../src/helpers/web3';
import { calculateOTokenRewards } from '../calculate-otoken-rewards';
import { calculateOTokenSeasonConfig } from '../calculate-otoken-season-config';
import {
  getOTokenConfigFileNameWithPath,
  getOTokenMetadataFileNameWithPath,
  writeOTokenConfigToGitHub,
} from '../lib/config-helper';
import { OTokenConfigFile, OTokenEpochMetadata, OTokenType } from '../lib/data-types';
import { readFileFromGitHub, writeFileToGitHub } from '../lib/file-helpers';
import { requireIsArbitrumNetwork } from './utils';

async function executeOarbStipFlow() {
  requireIsArbitrumNetwork();

  const oTokenType = OTokenType.oARB;
  const { epochNumber: epoch, isEpochElapsed } = await calculateOTokenSeasonConfig(oTokenType);

  let merkleRoot: string | null = null;
  if (isEpochElapsed) {
    const result = await calculateOTokenRewards(oTokenType, epoch);
    merkleRoot = result.merkleRoot;
  }

  if (merkleRoot) {
    const networkId = dolomite.networkId;
    await writeMerkleRootOnChain(epoch, merkleRoot, OARBRewardsDistributor[networkId].address);

    const oTokenConfig = await readFileFromGitHub<OTokenConfigFile>(
      getOTokenConfigFileNameWithPath(networkId, oTokenType),
    );
    oTokenConfig.epochs[epoch].isMerkleRootWrittenOnChain = true;

    await writeOTokenConfigToGitHub(oTokenConfig, oTokenConfig.epochs[epoch]);

    // Once the merkle root is written, update the metadata to the new highest epoch that is finalized
    const metadataFilePath = getOTokenMetadataFileNameWithPath(networkId, oTokenType);
    const metadata = await readFileFromGitHub<OTokenEpochMetadata>(metadataFilePath)
    if (metadata.maxEpochNumber === epoch - 1) {
      metadata.maxEpochNumber = epoch;
    }

    await writeFileToGitHub(metadataFilePath, metadata, true);
  }
}

executeOarbStipFlow()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while running:', error);
    process.exit(1);
  });
