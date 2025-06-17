import { BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { DOLOMITE_API_SERVER_URL } from '@dolomite-exchange/zap-sdk';
import axios from 'axios';
import { ChainId } from '../../src/lib/chain-id';

export interface ODoloMetadata {
  odoloStartTimestamp: number;
  currentEpochIndex: number;
  currentEpochStartTimestamp: number;
  epochIndexForRewardWeights: number;
  epochStartTimestamp: number;
  epochRewards: number;
  epochs: number[];
  /**
   * Chain ID to token address to oDOLO per week (decimal format)
   */
  allChainWeights: Record<ChainId, Record<string, Decimal>>
}

export async function readODoloMetadataFromApi(epoch: number | undefined): Promise<ODoloMetadata> {
  const epochQuery = epoch !== undefined ? `?epoch=${epoch}` : '';
  const response = await axios.get(`${DOLOMITE_API_SERVER_URL}/liquidity-mining/odolo/metadata${epochQuery}`);
  const allChainWeights = response.data.metadata.allChainWeights;
  return {
    ...response.data.metadata,
    allChainWeights: Object.keys(allChainWeights).reduce((acc, chainId) => {
      acc[chainId] = {};
      Object.keys(allChainWeights[chainId]).forEach(tokenAddress => {
        acc[chainId][tokenAddress] = new BigNumber(allChainWeights[chainId][tokenAddress]);
      })
      return acc;
    }, {}),
  };
}
