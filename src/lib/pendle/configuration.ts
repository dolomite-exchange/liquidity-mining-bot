import { ChainId } from '../chain-id';
import { checkJsNumber } from '../invariants';
import { PoolConfiguration } from './types';

checkJsNumber('NETWORK_ID');
export const CHAIN = parseInt(process.env.NETWORK_ID!, 10) as ChainId;

const WBTC_MARKET_ID = 4;
const USDC_MARKET_ID = 17;

export const PENDLE_TREASURY_MAP: Record<ChainId, string | undefined> = {
  [ChainId.ArbitrumOne]: '0xc328dfcd2c8450e2487a91daa9b75629075b7a43'.toLowerCase(),
  [ChainId.Base]: undefined,
  [ChainId.Berachain]: undefined,
  [ChainId.Mantle]: '0x9f72a06084edd040e973c32bf026b1acf65db9ab'.toLowerCase(),
  [ChainId.PolygonZkEvm]: undefined,
  [ChainId.XLayer]: undefined,
}

export const PENDLE_TREASURY_ADDRESS = PENDLE_TREASURY_MAP[CHAIN];

export const POOL_INFO: Record<ChainId, Record<number, PoolConfiguration>> = {
  [ChainId.ArbitrumOne]: {
    [USDC_MARKET_ID]: {
      SY: '0x84e0efc0633041aac9d0196b7ac8af3505e8cc32'.toLowerCase(),
      YT: '0xc617daee26f67edbed5bd978f4f8e02a1f8c9a6c'.toLowerCase(),
      LPs: [
        {
          address: '0x0bd6890b3bb15f16430546147734b254d0b03059'.toLowerCase(),
          deployedBlock: 268_865_973,
        },
      ],
      decimals: 6,
      deployedBlock: 268_865_973,
      liquidLockers: [
        {
          // penpie
          address: '0x6db96bbeb081d2a85e0954c252f2c1dc108b3f81'.toLowerCase(),
          receiptToken: '0x2b397468ae498a1610c1f865dd2dd56006aa8490'.toLowerCase(),
          lpToken: '0x0bd6890b3bb15f16430546147734b254d0b03059'.toLowerCase(),
          deployedBlock: 269_868_690,
        },
        {
          // equilibira
          address: '0x64627901dadb46ed7f275fd4fc87d086cff1e6e3'.toLowerCase(),
          receiptToken: '0x0cacf4acdaab8664857c29755bd710b8bafdbec3'.toLowerCase(),
          lpToken: '0x0bd6890b3bb15f16430546147734b254d0b03059'.toLowerCase(),
          deployedBlock: 269_275_940,
        },
        {
          // stakedao
          address: '0x0000000000000000000000000000000000000000'.toLowerCase(),
          receiptToken: '0x0000000000000000000000000000000000000000'.toLowerCase(),
          lpToken: '0x0000000000000000000000000000000000000000'.toLowerCase(),
          deployedBlock: 0,
        },
      ],
    },
    // {
    //       SY: '0x84e0efc0633041aac9d0196b7ac8af3505e8cc32'.toLowerCase(),
    //       YT: '0x916758e7605d0a4da4d9144e4e6ffc46e401ee67'.toLowerCase(),
    //       LPs: [
    //         {
    //           address: '0x2fb73d98b1d60b35fd12508933578098f352ce7e'.toLowerCase(),
    //           deployedBlock: 220_943_848,
    //         },
    //       ],
    //       decimals: 6,
    //       liquidLockers: [
    //         {
    //           // penpie
    //           address: '0x6db96bbeb081d2a85e0954c252f2c1dc108b3f81'.toLowerCase(),
    //           receiptToken: '0x0429a6d215187899ec9e01f1c025f8f425e65ad7'.toLowerCase(),
    //           lpToken: '0x2fb73d98b1d60b35fd12508933578098f352ce7e'.toLowerCase(),
    //           deployedBlock: 222_374_289,
    //         },
    //         {
    //           // equilibira
    //           address: '0x64627901dadb46ed7f275fd4fc87d086cff1e6e3'.toLowerCase(),
    //           receiptToken: '0x9991d1ee8769539a2b9639c8fb45f4159af0b2e9'.toLowerCase(),
    //           lpToken: '0x2fb73d98b1d60b35fd12508933578098f352ce7e'.toLowerCase(),
    //           deployedBlock: 222_045_963,
    //         },
    //         {
    //           // stakedao
    //           address: '0x0000000000000000000000000000000000000000'.toLowerCase(),
    //           receiptToken: '0x0000000000000000000000000000000000000000'.toLowerCase(),
    //           lpToken: '0x0000000000000000000000000000000000000000'.toLowerCase(),
    //           deployedBlock: 0,
    //         },
    //       ],
    //     }
    [WBTC_MARKET_ID]: {
      SY: '0x3055a746e040bd05ad1806840ca0114d632bc7e2'.toLowerCase(),
      YT: '0x458db433b74b1094c8282152500f6d5bdf062eb0'.toLowerCase(),
      LPs: [
        {
          address: '0x8cab5fd029ae2fbf28c53e965e4194c7260adf0c'.toLowerCase(),
          deployedBlock: 268_953_118,
        },
      ],
      decimals: 8,
      deployedBlock: 268_953_118,
      liquidLockers: [
        {
          // penpie
          address: '0x6db96bbeb081d2a85e0954c252f2c1dc108b3f81'.toLowerCase(),
          receiptToken: '0x107a8afae8572aab12e0dd3dc5155cb5ae49ac19'.toLowerCase(),
          lpToken: '0x8cab5fd029ae2fbf28c53e965e4194c7260adf0c'.toLowerCase(),
          deployedBlock: 269_868_690,
        },
        {
          // equilibira
          address: '0x64627901dadb46ed7f275fd4fc87d086cff1e6e3'.toLowerCase(),
          receiptToken: '0x2f35df137b64d1b62ae440b0d6a7b1cf9af4ab62'.toLowerCase(),
          lpToken: '0x8cab5fd029ae2fbf28c53e965e4194c7260adf0c'.toLowerCase(),
          deployedBlock: 269_276_017,
        },
        {
          // stakedao
          address: '0x0000000000000000000000000000000000000000'.toLowerCase(),
          receiptToken: '0x0000000000000000000000000000000000000000'.toLowerCase(),
          lpToken: '0x0000000000000000000000000000000000000000'.toLowerCase(),
          deployedBlock: 0,
        },
      ],
    },
  },
  [ChainId.Base]: {},
  [ChainId.Berachain]: {},
  [ChainId.Mantle]: {},
  [ChainId.PolygonZkEvm]: {},
  [ChainId.XLayer]: {},
};
