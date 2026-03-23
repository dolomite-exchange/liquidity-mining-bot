import { readVeDoloRebateMetadataFromApi } from '../../scripts/lib/api-helpers';

export async function getVeDoloRebateCurrentEpochNumber(): Promise<number> {
  return (await readVeDoloRebateMetadataFromApi()).onchainEpochIndex;
}
