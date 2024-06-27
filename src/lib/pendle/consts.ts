import { ethers } from 'ethers';
import '../env';

import PendleYieldTokenABI from './abi/pendle-yield-token.json';
import PendleMarketABI from './abi/pendle-market.json';

export const MULTICALL_BATCH_SIZE = 500;
export const _1E18 = ethers.BigNumber.from(10).pow(18);

export const ABIs = {
  pendleYieldToken: PendleYieldTokenABI,
  pendleMarket: PendleMarketABI,
};

export const Contracts = {
  yieldTokenInterface: new ethers.utils.Interface(ABIs.pendleYieldToken),
  marketInterface: new ethers.utils.Interface(ABIs.pendleMarket),
};
