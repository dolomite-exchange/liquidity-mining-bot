interface GraphqlResult {
  errors: any[]
}

export interface GraphqlAccountResult extends GraphqlResult {
  data: {
    marginAccounts: GraphqlAccount[]
  }
}

export interface GraphqlTokenValue {
  token: {
    id: string
    marketId: string
    name: string
    symbol: string
    decimals: string
  }
  valuePar: string
  expirationTimestamp: string | null
  expiryAddress: string | null
}

export interface GraphqlAccount {
  id: string
  user: {
    id
    effectiveUser: {
      id: string
    }
  }
  accountNumber: string
  tokenValues: GraphqlTokenValue[]
}

interface GraphqlMarginAccount {
  user: {
    id: string
  }
  accountNumber: string
}

interface InterestIndexSnapshot {
  supplyIndex: string
  borrowIndex: string
}

export interface GraphqlDeposit {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  amountDeltaPar: string
  effectiveUser: {
    id: string
  }
  token: {
    marketId: string
  }
  marginAccount: GraphqlMarginAccount
  amountDeltaWei: string
  interestIndex: InterestIndexSnapshot
}

export interface GraphqlDepositsResult extends GraphqlResult {
  data: {
    deposits: GraphqlDeposit[]
  }
}

export interface GraphqlAmmLiquidityPosition {
  id: string
  effectiveUser: {
    id: string
  }
  liquidityTokenBalance: string
  pair: {
    id: string;
  }
}

export interface GraphqlAmmLiquidityPositionsResult extends GraphqlResult {
  data: {
    ammLiquidityPositions: GraphqlAmmLiquidityPosition[]
  }
}

export interface GraphqlAmmLiquidityPositionSnapshot {
  id: string
  effectiveUser: {
    id: string
  }
  pair: {
    id: string
  }
  liquidityTokenBalance: string
  block: string
  timestamp: string
}

export interface GraphqlAmmLiquidityPositionSnapshotsResult extends GraphqlResult {
  data: {
    ammLiquidityPositionSnapshots: GraphqlAmmLiquidityPositionSnapshot[]
  }
}

export interface GraphqlLiquidation {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  solidEffectiveUser: {
    id: string
  }
  liquidEffectiveUser: {
    id: string
  }
  solidMarginAccount: GraphqlMarginAccount
  liquidMarginAccount: GraphqlMarginAccount
  heldToken: {
    marketId: string
  }
  heldTokenAmountDeltaWei: string
  heldTokenLiquidationRewardWei: string
  borrowedToken: {
    marketId: string
  }
  borrowedTokenAmountDeltaWei
  solidHeldTokenAmountDeltaPar: string
  liquidHeldTokenAmountDeltaPar: string
  solidBorrowedTokenAmountDeltaPar: string
  liquidBorrowedTokenAmountDeltaPar: string
  heldInterestIndex: InterestIndexSnapshot
  borrowedInterestIndex: InterestIndexSnapshot
}

export interface GraphqlLiquidationsResult extends GraphqlResult {
  data: {
    liquidations: GraphqlLiquidation[]
  }
}

export interface GraphqlVaporization {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  solidEffectiveUser: {
    id: string
  }
  vaporEffectiveUser: {
    id: string
  }
  solidMarginAccount: GraphqlMarginAccount
  vaporMarginAccount: GraphqlMarginAccount
  heldToken: {
    marketId: string
  }
  heldTokenAmountDeltaWei: string
  heldTokenLiquidationRewardWei: string
  borrowedToken: {
    marketId: string
  }
  borrowedTokenAmountDeltaWei
  solidHeldTokenAmountDeltaPar: string
  solidBorrowedTokenAmountDeltaPar: string
  vaporBorrowedTokenAmountDeltaPar: string
  heldInterestIndex: InterestIndexSnapshot
  borrowedInterestIndex: InterestIndexSnapshot
}

export interface GraphqlVaporizationsResult extends GraphqlResult {
  data: {
    vaporizations: GraphqlVaporization[]
  }
}

export interface GraphqlTrade {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  takerEffectiveUser: {
    id: string
  }
  takerToken: {
    marketId: string
  }
  takerTokenDeltaWei: string
  takerInputTokenDeltaPar: string
  takerOutputTokenDeltaPar: string
  makerEffectiveUser: {
    id: string
  }
  makerToken: {
    marketId: string
  }
  makerTokenDeltaWei: string
  takerInterestIndex: InterestIndexSnapshot
  makerInterestIndex: InterestIndexSnapshot
}

export interface GraphqlTradesResult extends GraphqlResult {
  data: {
    trades: GraphqlTrade[]
  }
}

export interface GraphqlTransfer {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  fromAmountDeltaPar: string
  toAmountDeltaPar: string
  fromEffectiveUser: {
    id: string
  }
  toEffectiveUser: {
    id: string
  }
  fromMarginAccount: GraphqlMarginAccount
  toMarginAccount: GraphqlMarginAccount
  token: {
    marketId: string
  }
  amountDeltaWei: string
  interestIndex: InterestIndexSnapshot
}

export interface GraphqlTransfersResult extends GraphqlResult {
  data: {
    transfers: GraphqlTransfer[]
  }
}

export interface GraphqlLiquidityMiningVestingPosition {
  id: string
  owner: {
    id: string
  }
  vester: {
    pairToken: {
      marketId: string
    }
  }
  pairAmountPar: string
  paymentAmountWei: string
  oTokenAmount: string
  status: string
  startTimestamp: string
  endTimestamp: string
  duration: string
}

export interface GraphqlLiquidityMiningLevelUpdateRequests {
  id: string
  user: {
    id: string
  }
  requestId: string
}

export interface GraphqlLiquidityMiningVestingPositionsResult extends GraphqlResult {
  data: {
    liquidityMiningVestingPositions: GraphqlLiquidityMiningVestingPosition[]
  }
}

export interface GraphqlLiquidityMiningLevelUpdateRequestsResult extends GraphqlResult {
  data: {
    liquidityMiningLevelUpdateRequests: GraphqlLiquidityMiningLevelUpdateRequests[]
  }
}

export interface GraphqlWithdrawal {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  amountDeltaPar: string
  effectiveUser: {
    id: string
  }
  token: {
    marketId: string
  }
  marginAccount: GraphqlMarginAccount
  amountDeltaWei: string
  interestIndex: InterestIndexSnapshot
}

export interface GraphqlWithdrawalsResult extends GraphqlResult {
  data: {
    withdrawals: GraphqlWithdrawal[]
  }
}

export interface GraphqlMarketResult extends GraphqlResult {
  data: {
    marketRiskInfos: GraphqlMarket[]
  }
  errors: any
}

export interface GraphqlToken {
  id: string
  decimals: string
  marketId: string
  name: string
  symbol: string
}

export interface GraphqlMarket {
  id: string
  token: GraphqlToken
  marginPremium: string
  liquidationRewardPremium: string
}

export interface GraphqlRiskParamsResult extends GraphqlResult {
  data: {
    dolomiteMargins: GraphqlRiskParams[]
  }
}

export interface GraphqlRiskParams {
  id: string
  liquidationRatio: string
  liquidationReward: string
}

interface GraphqlBlockResult extends GraphqlResult {
  number: string
}

export interface GraphqlTimestampToBlockResult extends GraphqlResult {
  data: Record<string, GraphqlBlockResult[]>
}

export interface GraphqlAmmPairData {
  volumeUSD: string
  reserveUSD: string
  reserve0: string
  reserve1: string
  totalSupply: string
}

export interface GraphqlInterestRate {
  supplyInterestRate: string
}

export interface GraphqlAmmLiquidityPosition {
  liquidityTokenBalance: string
}

type GraphqlAmmDataForUserResultSubResult = GraphqlAmmPairData | GraphqlInterestRate | GraphqlAmmLiquidityPosition

export interface GraphqlAmmDataForUserResult extends GraphqlResult {
  data: Record<string, GraphqlAmmDataForUserResultSubResult[]>
}

export interface GraphqlVestingPositionTransfer {
  id: string
  serialId: string
  transaction: {
    timestamp: string
  }
  fromEffectiveUser: {
    id: string
  }
  toEffectiveUser: {
    id: string
  }
  vestingPosition: GraphqlLiquidityMiningVestingPosition
}

export interface GraphqlVestingPositionTransfersResult extends GraphqlResult {
  data: {
    liquidityMiningVestingPositionTransfers: GraphqlVestingPositionTransfer[]
  }
}
