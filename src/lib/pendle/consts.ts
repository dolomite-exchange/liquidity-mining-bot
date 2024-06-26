import { ethers } from 'ethers';
import '../env';

import MulticallABI from './abi/multi-call.json';
import PendleYieldTokenABI from './abi/pendle-yield-token.json';
import PendleMarketABI from './abi/pendle-market.json';

export const MULTICALL_ADDRESS = '0xeefba1e63905ef1d7acba5a8513c70307c1ce441';
export const PENDLE_TREASURY = '0x8270400d528c34e1596ef367eedec99080a1b592';
export const MULTICALL_BATCH_SIZE = 1_000;
export const _1E18 = ethers.BigNumber.from(10).pow(18);
export const PROVIDER = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);

export const ABIs = {
  multicall: MulticallABI,
  pendleYieldToken: PendleYieldTokenABI,
  pendleMarket: PendleMarketABI
};

export const Contracts = {
  multicall: new ethers.Contract(MULTICALL_ADDRESS, ABIs.multicall, PROVIDER),
  yieldTokenInterface: new ethers.utils.Interface(ABIs.pendleYieldToken),
  marketInterface: new ethers.utils.Interface(ABIs.pendleMarket)
};
