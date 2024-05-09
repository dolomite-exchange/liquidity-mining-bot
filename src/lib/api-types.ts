import { address, BigNumber, Decimal, Integer } from '@dolomite-exchange/dolomite-margin';

export interface ApiMarginAccount {
  user: string;
  accountNumber: string;
}

export interface ApiBalance {
  marketId: number;
  tokenDecimals: number;
  tokenAddress: string
  tokenName: string
  tokenSymbol: string
  par: Integer;
  wei: Integer;
  expiresAt: Integer | null;
  expiryAddress: string | null;
}

export interface ApiAccount {
  id: string;
  owner: string;
  number: Integer;
  effectiveUser: string;
  balances: {
    [marketNumber: string]: ApiBalance;
  };
}

export interface ApiDeposit {
  id: string;
  serialId: number;
  timestamp: number;
  effectiveUser: string;
  marginAccount: ApiMarginAccount;
  marketId: number;
  amountDeltaPar: Decimal;
  amountDeltaWei: Decimal;
  interestIndex: MarketIndex;
}

export interface ApiAmmLiquidityPosition {
  id: string;
  effectiveUser: string;
  balance: Decimal;
}

export interface ApiAmmLiquiditySnapshot {
  id: string;
  effectiveUser: string;
  liquidityTokenBalance: string;
  block: string;
  timestamp: string;
}

export interface ApiLiquidation {
  id: string;
  serialId: number;
  timestamp: number;
  solidEffectiveUser: string;
  liquidEffectiveUser: string;
  solidMarginAccount: ApiMarginAccount;
  liquidMarginAccount: ApiMarginAccount;
  heldMarketId: number;
  borrowedMarketId: number;
  heldTokenAmountDeltaWei: Decimal;
  borrowedTokenAmountDeltaWei: Decimal;
  solidHeldTokenAmountDeltaPar: Decimal;
  liquidHeldTokenAmountDeltaPar: Decimal;
  solidBorrowedTokenAmountDeltaPar: Decimal;
  liquidBorrowedTokenAmountDeltaPar: Decimal;
  heldInterestIndex: MarketIndex;
  borrowedInterestIndex: MarketIndex;
}

export interface ApiMarket {
  marketId: number
  symbol: string
  name: string
  tokenAddress: address
  decimals: number
  marginPremium: Integer
  liquidationRewardPremium: Integer
}

export interface ApiRiskParam {
  dolomiteMargin: address;
  liquidationRatio: Integer;
  liquidationReward: Integer;
}

export interface ApiTransfer {
  id: string;
  serialId: number;
  timestamp: number;
  fromEffectiveUser: string;
  toEffectiveUser: string;
  fromMarginAccount: ApiMarginAccount;
  toMarginAccount: ApiMarginAccount;
  marketId: number;
  amountDeltaWei: Decimal;
  fromAmountDeltaPar: Decimal;
  toAmountDeltaPar: Decimal;
  interestIndex: MarketIndex;
}

export interface ApiTrade {
  id: string;
  serialId: number;
  timestamp: number;
  takerEffectiveUser: string;
  takerMarginAccount: ApiMarginAccount;
  takerMarketId: number;
  makerTokenDeltaWei: Decimal;
  takerTokenDeltaWei: Decimal;
  takerInputTokenDeltaPar: Decimal;
  takerOutputTokenDeltaPar: Decimal;
  makerInputTokenDeltaPar: Decimal;
  makerOutputTokenDeltaPar: Decimal;
  makerEffectiveUser: string | undefined;
  makerMarginAccount: ApiMarginAccount | undefined;
  makerMarketId: number;
  makerInterestIndex: MarketIndex;
  takerInterestIndex: MarketIndex;
}

export interface ApiVestingPositionTransfer {
  id: string;
  serialId: number;
  timestamp: number;
  fromEffectiveUser: string | undefined;
  toEffectiveUser: string | undefined;
  amount: Decimal;
}

export enum ApiLiquidityMiningVestingPositionStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
  FORCE_CLOSED = 'FORCE_CLOSED',
  EMERGENCY_CLOSED = 'EMERGENCY_CLOSED',
}

export interface ApiLiquidityMiningVestingPosition {
  id: string;
  effectiveUser: string;
  marketId: number;
  amountPar: Decimal;
  oTokenAmount: Decimal;
  otherTokenSpent: Decimal;
  duration: number;
  startTimestamp: number;
  endTimestamp: number;
  status: ApiLiquidityMiningVestingPositionStatus;
}

export interface ApiLiquidityMiningLevelUpdateRequest {
  effectiveUser: string;
  requestId: BigNumber;
}

export interface ApiWithdrawal {
  id: string;
  serialId: number;
  timestamp: number;
  effectiveUser: string;
  marginAccount: ApiMarginAccount;
  marketId: number;
  amountDeltaPar: Decimal;
  amountDeltaWei: Decimal;
  interestIndex: MarketIndex;
}

export interface MarketIndex {
  marketId: number
  borrow: Decimal
  supply: Decimal
}
