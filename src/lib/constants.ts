import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ChainId } from './chain-id';
import { GraphqlToken } from './graphql-types';

export const NETWORK_ID = Number(process.env.NETWORK_ID);

export const ONE_ETH_WEI = new BigNumber(10).pow(18);

export const PENDLE_MULTISIG_MAP: Record<ChainId, string | undefined> = {
  [ChainId.ArbitrumOne]: '0xCbcb48e22622a3778b6F14C2f5d258Ba026b05e6',
  [ChainId.Base]: undefined,
  [ChainId.Mantle]: '0x5C30d3578A4D07a340650a76B9Ae5dF20D5bdF55',
  [ChainId.PolygonZkEvm]: undefined,
  [ChainId.XLayer]: undefined,
}

// ==================== Isolation Mode Getters ====================

export function isIsolationModeToken(token: GraphqlToken): boolean {
  return token.name.includes('Dolomite Isolation:') || token.symbol === 'dfsGLP';
}
