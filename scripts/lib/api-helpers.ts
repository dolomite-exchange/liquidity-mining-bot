import { BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import { DOLOMITE_API_SERVER_URL } from '@dolomite-exchange/zap-sdk';
import axios from 'axios';
import { ChainId } from '../../src/lib/chain-id';

export interface ODoloMetadata {
  odoloStartTimestamp: number;
  currentEpochIndex: number;
  onchainEpochIndex: number;
  currentEpochStartTimestamp: number;
  epochIndexForRewardWeights: number;
  epochStartTimestamp: number;
  epochRewards: number;
  epochs: number[];
  /**
   * Chain ID to token address to oDOLO per week (decimal format)
   */
  allChainWeights: Record<ChainId, Record<string, Decimal>>
  allChainStartEpochs: Record<ChainId, number | null>
}

export interface VeDoloRebateMetadata {
  /**
   * Timestamp the program started (which corresponds with epoch 1)
   */
  startTimestamp: number;
  /**
   * 1-based index for the current epoch
   */
  currentEpochIndex: number;
  /**
   * The index that's currently written onchain
   */
  onchainEpochIndex: number;
  /**
   * Start timestamp of the current epoch
   */
  currentEpochStartTimestamp: number;
  allChainStartEpochs: Record<ChainId, number | null>
  /**
   * decimal number (0.10 equals 10% rebate on all borrow fees paid)
   */
  maximumRebatePercentage: number;
  /**
   * Decimal number (5.0 means the user must have at least 5x the maximumRebatePercentage as veDOLO to qualify for the
   * max discount)
   */
  veDoloHoldingFactor: number;
}

export async function readODoloMetadataFromApi(epoch: number | undefined): Promise<ODoloMetadata> {
  const epochQuery = epoch !== undefined ? `?epoch=${epoch}` : '';
  const response = await axios.get(`${DOLOMITE_API_SERVER_URL}/liquidity-mining/odolo/metadata${epochQuery}`);
  const { allChainWeights } = response.data.metadata;
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

export async function readVeDoloRebateMetadataFromApi(): Promise<VeDoloRebateMetadata> {
  const response = await axios.get(`${DOLOMITE_API_SERVER_URL}/liquidity-mining/ve-dolo-rebates/metadata`);
  return response.data.metadata
}
