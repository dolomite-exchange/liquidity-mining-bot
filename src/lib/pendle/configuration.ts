import { ChainId } from '../chain-id';
import { checkJsNumber } from '../invariants';
import { PoolConfiguration } from './types';

checkJsNumber('NETWORK_ID');
export const CHAIN = parseInt(process.env.NETWORK_ID!, 10) as ChainId;

const WBERA_MARKET_ID = 1;
const WBTC_MARKET_ID = 4;
const USDC_MARKET_ID = 17;

export const PENDLE_TREASURY_MAP: Record<ChainId, string | undefined> = {
  [ChainId.ArbitrumOne]: '0xc328dfcd2c8450e2487a91daa9b75629075b7a43'.toLowerCase(),
  [ChainId.Base]: undefined,
  [ChainId.Berachain]: '0xC328dFcD2C8450e2487a91daa9B75629075b7A43',
  [ChainId.Botanix]: undefined,
  [ChainId.Ethereum]: undefined,
  [ChainId.Ink]: undefined,
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
    },
    [WBTC_MARKET_ID]: {
      SY: '0x43fe63e84f135a0c3b40270a03e6ddbcb393f9e9'.toLowerCase(),
      YT: '0xb178ddf95eb08933583908f17bc522bb9a694bfd'.toLowerCase(),
      LPs: [
        {
          address: '0x0ec0abdd2245cd94a054483ccce50a38ac93eb1b'.toLowerCase(),
          deployedBlock: 354_020_492,
        },
      ],
      decimals: 8,
      deployedBlock: 354_020_492,
    },
  },
  [ChainId.Base]: {},
  [ChainId.Berachain]: {
    [WBERA_MARKET_ID]: {
      SY: '0x9e88f2990c48315dace55ffda9950fc287362109'.toLowerCase(),
      YT: '0xcb623b3f6f216e36a599228b2921ace0ea499d0d'.toLowerCase(),
      LPs: [
        {
          address: '0x5200c9900436f649b4659dfc79213837dcccaab1'.toLowerCase(),
          deployedBlock: 3_434_908,
        },
      ],
      decimals: 18,
      deployedBlock: 3_434_908,
    },
  },
  [ChainId.Botanix]: {},
  [ChainId.Ethereum]: {},
  [ChainId.Ink]: {},
  [ChainId.Mantle]: {},
  [ChainId.PolygonZkEvm]: {},
  [ChainId.XLayer]: {},
};
