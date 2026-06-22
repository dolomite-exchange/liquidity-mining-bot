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

export interface VeDoloRebateInfo {
  startEpoch: number;
  rebatePercentage: number;
  marketToRebateInfo: {
    [marketId: string]: {
      startEpoch: number;
      endEpoch: number | null;
    }
  }
}

export interface VeDoloRebateMetadata {
  /**
   * Timestamp the program started (which corresponds with epoch 1)
   */
  veDoloStartTimestamp: number;
  /**
   * 1-based index for the current epoch
   */
  currentEpochIndex: number;
  /**
   * Start timestamp of the current epoch
   */
  currentEpochStartTimestamp: number;
  onchainFeeRebateEpochIndexMap: Record<ChainId, number | null>
  onchainRollingClaimsEpochIndexMap: Record<ChainId, number | null>
  allChainRebateInfo: Record<ChainId, VeDoloRebateInfo | null>
  /**
   * Decimal number (5.0 means the user must have at least 5x the maximumRebatePercentage as veDOLO to qualify for the
   * max discount). If the maxRebateUsd for a user is $5 and the factor is 3, then the user must have $15 of veDOLO.
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
  const response = await axios.get(`${DOLOMITE_API_SERVER_URL}/liquidity-mining/ve-dolo-rebate/metadata`);
  return response.data.metadata
}
