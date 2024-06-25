import { ChainId } from '../chain-id';
import { checkJsNumber } from '../invariants';
import { PoolConfiguration } from './types';

checkJsNumber('NETWORK_ID');
export const CHAIN = parseInt(process.env.NETWORK_ID!) as ChainId;

const USDC_MARKET_ID = 17;

const PENDLE_TREASURY_MAP: Record<ChainId, string | undefined> = {
  [ChainId.ArbitrumOne]: '0x7877AdFaDEd756f3248a0EBfe8Ac2E2eF87b75Ac'.toLowerCase(),
  [ChainId.Base]: undefined,
  [ChainId.Mantle]: '0x9F72a06084EdD040E973C32Bf026b1ACf65db9aB'.toLowerCase(),
  [ChainId.PolygonZkEvm]: undefined,
  [ChainId.XLayer]: undefined,
}

export const PENDLE_TREASURY_ADDRESS = PENDLE_TREASURY_MAP[CHAIN];

export const POOL_INFO: Record<ChainId, Record<string, PoolConfiguration>> = {
  [ChainId.ArbitrumOne]: {
    [USDC_MARKET_ID]: {
      SY: '0x84e0efc0633041aac9d0196b7ac8af3505e8cc32'.toLowerCase(),
      YT: '0x916758e7605d0a4da4d9144e4e6ffc46e401ee67'.toLowerCase(),
      LPs: [
        {
          address: '0x2fb73d98b1d60b35fd12508933578098f352ce7e'.toLowerCase(),
          deployedBlock: 220_943_848,
        },
      ],
      liquidLockers: [
        {
          // penpie
          address: '0x6db96bbeb081d2a85e0954c252f2c1dc108b3f81'.toLowerCase(),
          receiptToken: '0x0429a6d215187899ec9e01f1c025f8f425e65ad7'.toLowerCase(),
          lpToken: '0x2fb73d98b1d60b35fd12508933578098f352ce7e'.toLowerCase(),
          deployedBlock: 222_374_289,
        },
        {
          // equilibira
          address: '0x64627901dadb46ed7f275fd4fc87d086cff1e6e3'.toLowerCase(),
          receiptToken: '0x9991d1ee8769539a2b9639c8fb45f4159af0b2e9'.toLowerCase(),
          lpToken: '0x2fb73d98b1d60b35fd12508933578098f352ce7e'.toLowerCase(),
          deployedBlock: 222_045_963,
        },
        {
          // stakedao
          address: '0x0000000000000000000000000000000000000000'.toLowerCase(),
          receiptToken: '0x0000000000000000000000000000000000000000'.toLowerCase(),
          lpToken: '0x0000000000000000000000000000000000000000'.toLowerCase(),
          deployedBlock: 0,
        },
      ],
    }
  },
  [ChainId.Base]: {},
  [ChainId.Mantle]: {},
  [ChainId.PolygonZkEvm]: {},
  [ChainId.XLayer]: {},
};
