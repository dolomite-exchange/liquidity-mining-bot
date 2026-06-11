import { readVeDoloRebateMetadataFromApi } from '../../scripts/lib/api-helpers';
import { ChainId } from '../lib/chain-id';

export async function getVeDoloRebateRollingClaimsCurrentEpochNumber(networkId: ChainId): Promise<number | null> {
  return (await readVeDoloRebateMetadataFromApi()).onchainRollingClaimsEpochIndexMap[networkId];
}
