import { ODoloRollingClaimsProxy } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { ethers } from 'ethers';
import { ChainId } from '../lib/chain-id';
import { dolomite } from './web3';

const CURRENT_EPOCH_METHOD_ID = '0x76671808'; // method ID for #currentEpoch

export async function getODoloCurrentEpochNumber(): Promise<number> {
  if (dolomite.networkId !== ChainId.Berachain) {
    return Promise.reject(new Error('Invalid network ID, expected Berachain!'));
  }

  const result = await dolomite.web3.eth.call({
    to: ODoloRollingClaimsProxy[ChainId.Berachain].address,
    data: CURRENT_EPOCH_METHOD_ID,
  })

  const epoch = ethers.utils.defaultAbiCoder.decode(['uint256'], result)[0] as ethers.BigNumber;
  return epoch.toNumber();
}
