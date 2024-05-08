import { ChainId } from '../../src/lib/chain-id';

const PERFECT_SWAP_MULTISIG = '0x986aFdBd5FD682655361FE0d08b7C9a2d28caDe9'.toLowerCase();

const ACCOUNT_MAP: Record<ChainId, Record<string, string | undefined>> = {
  [ChainId.ArbitrumOne]: {
    ['0xc21e703B4077DB4f11b1D9FA2694Bb5Fc03ab480'.toLowerCase()]: PERFECT_SWAP_MULTISIG, // ARB vault
    ['0x4165427a868C0136a98A1e818287B648b33d6a88'.toLowerCase()]: PERFECT_SWAP_MULTISIG, // ETH vault
    ['0x81e4143527aaE64E6B55806D89A132D233A46AC4'.toLowerCase()]: PERFECT_SWAP_MULTISIG, // USDC vault
    ['0xaAe6C4F82185810C7ACC36C0Fe9c2B5D07FeE188'.toLowerCase()]: PERFECT_SWAP_MULTISIG, // WBTC vault
  },
  [ChainId.Base]: {},
  [ChainId.Mantle]: {},
  [ChainId.PolygonZkEvm]: {},
  [ChainId.XLayer]: {},
}

export function remapAccountToClaimableAccount(chainId: ChainId, account: string): string {
  return ACCOUNT_MAP[chainId][account] ?? account;
}
