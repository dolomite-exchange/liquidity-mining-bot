import { BigNumber, Integer } from '@dolomite-exchange/dolomite-margin';
import { ChainId } from './chain-id';
import { GraphqlToken } from './graphql-types';

export const NETWORK_ID = Number(process.env.NETWORK_ID);

export const ONE_ETH_WEI: Integer = new BigNumber(10).pow(18);

export const ONE_DOLLAR: Integer = new BigNumber(10).pow(36);

export const ONE_WEEK_SECONDS = 604_800;

export const REBATE_START_TIMESTAMP_MAP: { [networkId: number]: number } = {
  [ChainId.Berachain]: 1779920962,
};

export function isIsolationModeToken(token: GraphqlToken): boolean {
  return token.name.includes('Dolomite Isolation:') || token.symbol === 'dfsGLP';
}

export const RESERVE_FACTOR = new BigNumber(0.2);

export const REVENUE_MARGIN_OF_ERROR = new BigNumber(0.05);
