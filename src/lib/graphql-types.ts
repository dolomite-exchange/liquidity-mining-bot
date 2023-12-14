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
  heldToken: {
    marketId: string
  }
  heldTokenAmountDeltaWei
  heldTokenLiquidationRewardWei
  borrowedToken: {
    marketId: string
  }
  borrowedTokenAmountDeltaWei
  solidHeldTokenAmountDeltaPar: string
  liquidHeldTokenAmountDeltaPar: string
  solidBorrowedTokenAmountDeltaPar: string
  liquidBorrowedTokenAmountDeltaPar: string
}

export interface GraphqlLiquidationsResult extends GraphqlResult {
  data: {
    liquidations: GraphqlLiquidation[]
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
  takerTokenDeltaWei: string;
  takerInputTokenDeltaPar: string;
  takerOutputTokenDeltaPar: string;
  makerEffectiveUser: {
    id: string
  }
  makerToken: {
    marketId: string
  }
  makerTokenDeltaWei: string;
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
  token: {
    marketId: string
  }
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
  oARBAmount: string
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
  vestingPosition: {
    arbAmountPar: string
  }
}

export interface GraphqlVestingPositionTransfersResult extends GraphqlResult {
  data: {
    liquidityMiningVestingPositionTransfers: GraphqlVestingPositionTransfer[]
  }
}
