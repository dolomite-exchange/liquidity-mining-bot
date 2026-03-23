import { readODoloMetadataFromApi } from '../../scripts/lib/api-helpers';

/**
 * Gets the current epoch that is written onchain
 */
export async function getODoloCurrentEpochNumber(): Promise<number> {
  return (await readODoloMetadataFromApi(undefined)).onchainEpochIndex;
}
