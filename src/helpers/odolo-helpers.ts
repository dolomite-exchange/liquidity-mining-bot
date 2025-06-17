import { ODoloRollingClaimsProxy } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import axios from 'axios';
import { ethers } from 'ethers';
import { ChainId } from '../lib/chain-id';

const CURRENT_EPOCH_METHOD_ID = '0x76671808'; // method ID for #currentEpoch

export async function getODoloCurrentEpochNumber(): Promise<number> {
  const chainId = ChainId.Berachain;
  const result = await axios.get(
    'https://api.etherscan.io/v2/api',
    {
      params: {
        chainid: chainId,
        module: 'proxy',
        action: 'eth_call',
        to: ODoloRollingClaimsProxy[chainId].address,
        data: CURRENT_EPOCH_METHOD_ID,
        tag: 'latest',
        apikey: process.env.ETHERSCAN_API_KEY,
      },
    },
  );

  const epoch = ethers.utils.defaultAbiCoder.decode(['uint256'], result.data.result)[0] as ethers.BigNumber;
  return epoch.toNumber();
}
