/* eslint-disable max-len */
import { BigNumber, Decimal, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { decimalToString } from '@dolomite-exchange/dolomite-margin/dist/src/lib/Helpers';
import axios from 'axios';
import { isMarketIgnored } from '../helpers/market-helpers';
import {
  ApiAccount,
  ApiAmmLiquidityPosition,
  ApiAmmLiquiditySnapshot,
  ApiBalance,
  ApiDeposit,
  ApiLiquidation,
  ApiLiquidityMiningLevelUpdateRequest,
  ApiLiquidityMiningVestingPosition,
  ApiLiquidityMiningVestingPositionStatus,
  ApiMarket,
  ApiRiskParam,
  ApiTrade,
  ApiTransfer,
  ApiVestingPositionTransfer,
  ApiWithdrawal,
  MarketIndex,
} from '../lib/api-types';
import {
  GraphqlAccount,
  GraphqlAccountResult,
  GraphqlAmmLiquidityPositionSnapshotsResult,
  GraphqlAmmLiquidityPositionsResult,
  GraphqlDepositsResult,
  GraphqlLiquidationsResult,
  GraphqlLiquidityMiningLevelUpdateRequestsResult,
  GraphqlLiquidityMiningVestingPositionsResult,
  GraphqlMarketResult,
  GraphqlRiskParamsResult,
  GraphqlTimestampToBlockResult,
  GraphqlTradesResult,
  GraphqlTransfersResult,
  GraphqlVestingPositionTransfersResult,
  GraphqlWithdrawalsResult,
} from '../lib/graphql-types';
import Pageable from '../lib/pageable';
import '../lib/env';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ethers = require('ethers');

const LIQUIDATION_FIELDS_GQL = `     id
        serialId
        transaction {
          timestamp
        }
        solidEffectiveUser {
          id
        }
        liquidEffectiveUser {
          id
        }
        solidMarginAccount {
          user {
            id
          }
          accountNumber
        }
        liquidMarginAccount {
          user {
            id
          }
          accountNumber
        }
        heldToken {
          marketId
        }
        heldTokenAmountDeltaWei
        heldTokenLiquidationRewardWei
        borrowedToken {
          marketId
        }
        borrowedTokenAmountDeltaWei
        solidHeldTokenAmountDeltaPar
        liquidHeldTokenAmountDeltaPar
        solidBorrowedTokenAmountDeltaPar
        liquidBorrowedTokenAmountDeltaPar
        heldInterestIndex {
          supplyIndex
          borrowIndex
        }
        borrowedInterestIndex {
          supplyIndex
          borrowIndex
        }`

const TRADE_FIELDS_GQL = `        id
        serialId
        transaction {
          timestamp
        }
        takerEffectiveUser {
          id
        }
        takerMarginAccount {
          user {
            id
          }
          accountNumber
        }
        takerToken {
          marketId
        }
        makerTokenDeltaWei
        takerTokenDeltaWei
        takerInputTokenDeltaPar
        takerOutputTokenDeltaPar
        makerInputTokenDeltaPar
        makerOutputTokenDeltaPar
        makerEffectiveUser {
          id
        }
        makerMarginAccount {
          user {
            id
          }
          accountNumber
        }
        makerToken {
          marketId
        }
        takerInterestIndex {
          supplyIndex
          borrowIndex
        }
        makerInterestIndex {
          supplyIndex
          borrowIndex
        }`;

const defaultAxiosConfig = {
  headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
};

const subgraphUrl = process.env.SUBGRAPH_URL ?? '';
if (!subgraphUrl) {
  throw new Error('SUBGRAPH_URL is not set')
}

async function getAccounts(
  marketIndexMap: { [marketId: string]: { borrow: Decimal, supply: Decimal } | undefined },
  query: string,
  blockNumber: number,
  lastId: string | undefined,
  extraVariables: Record<string, any> = {},
): Promise<{ accounts: ApiAccount[] }> {
  const accounts: ApiAccount[] = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        ...extraVariables,
        blockNumber,
        lastId: lastId ?? '',
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then((response: any) => {
      if (response.errors && typeof response.errors === 'object') {
        return Promise.reject((response.errors as any)[0]);
      } else {
        return (response as GraphqlAccountResult).data.marginAccounts;
      }
    })
    .then(graphqlAccounts => graphqlAccounts.reduce((memo, account) => {
      const apiAccount = _mapGraphqlAccountToApiAccount(account, marketIndexMap)
      if (apiAccount) {
        memo.push(apiAccount);
      }
      return memo;
    }, [] as ApiAccount[]));

  return { accounts };
}

export async function getDeposits(
  startBlock: number,
  endBlock: number,
  lastId: string,
  tokenAddress?: string,
): Promise<{ deposits: ApiDeposit[] }> {
  const query = `
  query getDeposits($startBlock: BigInt, $endBlock: Int, $lastId: ID) {
    deposits(
      first: ${Pageable.MAX_PAGE_SIZE},
      orderBy: id
      where: {
        transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }
        id_gt: $lastId
        ${tokenAddress ? `token: "${tokenAddress.toLowerCase()}"` : ''} 
      }
    ) {
      id
      serialId
      transaction {
        timestamp
      }
      amountDeltaWei
      amountDeltaPar
      token {
        marketId
      }
      marginAccount {
        user {
          id
        }
        accountNumber
      }
      effectiveUser {
        id
      }
      interestIndex {
        supplyIndex
        borrowIndex
      }
    }
  }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlDepositsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const deposits = ((result as GraphqlDepositsResult).data.deposits).map<ApiDeposit>(deposit => {
    return {
      id: deposit.id,
      serialId: parseInt(deposit.serialId, 10),
      timestamp: parseInt(deposit.transaction.timestamp, 10),
      marginAccount: {
        user: deposit.marginAccount.user.id.toLowerCase(),
        accountNumber: deposit.marginAccount.accountNumber,
      },
      effectiveUser: deposit.effectiveUser.id.toLowerCase(),
      marketId: new BigNumber(deposit.token.marketId).toNumber(),
      amountDeltaPar: new BigNumber(deposit.amountDeltaPar),
      amountDeltaWei: new BigNumber(deposit.amountDeltaWei),
      interestIndex: {
        marketId: new BigNumber(deposit.token.marketId).toNumber(),
        borrow: new BigNumber(deposit.interestIndex.borrowIndex),
        supply: new BigNumber(deposit.interestIndex.supplyIndex),
      },
    }
  });

  return { deposits };
}

export async function getLiquidations(
  startBlock: number,
  endBlock: number,
  lastId: string,
): Promise<{ liquidations: ApiLiquidation[] }> {
  const query = `
    query getLiquidations($startBlock: Int, $endBlock: Int, $lastId: ID) {
      liquidations(
        first: ${Pageable.MAX_PAGE_SIZE},
        orderBy: id
        where: {
            transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }
            id_gt: $lastId
        }
      ) {
        ${LIQUIDATION_FIELDS_GQL}
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlLiquidationsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const liquidations = result.data.liquidations.map(liquidation => _mapLiquidationGqlToApiLiquidation(liquidation));
  return { liquidations };
}

export async function getLiquidationsByHeldToken(
  startBlock: number,
  endBlock: number,
  lastId: string,
  heldTokenAddress: string,
): Promise<{ liquidations: ApiLiquidation[] }> {
  const query = `
    query getLiquidations($startBlock: Int, $endBlock: Int, $lastId: ID, $heldToken: String) {
      liquidations(
        first: ${Pageable.MAX_PAGE_SIZE},
        orderBy: id
        where: {
            transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }
            id_gt: $lastId
            heldToken: $heldToken
        }
      ) {
        ${LIQUIDATION_FIELDS_GQL}
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
        heldToken: heldTokenAddress.toLowerCase(),
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlLiquidationsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const liquidations = result.data.liquidations.map(liquidation => _mapLiquidationGqlToApiLiquidation(liquidation));
  return { liquidations };
}

export async function getLiquidationsByBorrowedToken(
  startBlock: number,
  endBlock: number,
  lastId: string,
  borrowedTokenAddress: string,
): Promise<{ liquidations: ApiLiquidation[] }> {
  const query = `
    query getLiquidations($startBlock: Int, $endBlock: Int, $lastId: ID, $borrowedToken: String) {
      liquidations(
        first: ${Pageable.MAX_PAGE_SIZE},
        orderBy: id
        where: {
            transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }
            id_gt: $lastId
            borrowedToken: $borrowedToken
        }
      ) {
        ${LIQUIDATION_FIELDS_GQL}
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
        borrowedToken: borrowedTokenAddress.toLowerCase(),
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlLiquidationsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const liquidations = result.data.liquidations.map(liquidation => _mapLiquidationGqlToApiLiquidation(liquidation));
  return { liquidations };
}

export async function getLiquidityMiningVestingPositions(
  blockNumber: number,
  lastId: string,
): Promise<{ liquidityMiningVestingPositions: ApiLiquidityMiningVestingPosition[] }> {
  const query = `
    query getLiquidityMiningVestingPositions($blockNumber: Int, $lastId: ID) {
      liquidityMiningVestingPositions(
        first: ${Pageable.MAX_PAGE_SIZE}
        orderBy: id
        where: { id_gt: $lastId }
        block: { number_gte: $blockNumber }
      ) {
        id
        owner {
          id
        }
        pairToken {
          marketId
        }
        pairAmountPar
        tokenSpent
        oTokenAmount
        status
        startTimestamp
        endTimestamp
        duration
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        blockNumber,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlLiquidityMiningVestingPositionsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const liquidityMiningVestingPositions = (result.data.liquidityMiningVestingPositions as any[]).map<ApiLiquidityMiningVestingPosition>(
    position => {
      return {
        id: position.id,
        effectiveUser: position.owner.id.toLowerCase(),
        amountPar: new BigNumber(position.pairAmountPar),
        marketId: new BigNumber(position.pairToken.marketId).toNumber(),
        oTokenAmount: new BigNumber(position.oTokenAmount),
        otherTokenSpent: new BigNumber(position.tokenSpent),
        startTimestamp: position.startTimestamp,
        endTimestamp: position.endTimestamp,
        duration: parseInt(position.duration, 10),
        status: position.status,
      };
    },
  );

  return { liquidityMiningVestingPositions };
}

export async function getExpiredLiquidityMiningVestingPositions(
  blockNumber: number,
  expirationTimestampWithBuffer: number,
): Promise<{ liquidityMiningVestingPositions: ApiLiquidityMiningVestingPosition[] }> {
  const query = `
    query getExpiredLiquidityMiningVestingPositions($blockNumber: Int, $timestamp: BigInt!) {
      liquidityMiningVestingPositions(
        first: ${Pageable.MAX_PAGE_SIZE}
        orderBy: endTimestamp
        orderDirection: asc
        where: { endTimestamp_lt: $timestamp, status: "${ApiLiquidityMiningVestingPositionStatus.ACTIVE}" }
        block: { number_gte: $blockNumber }
      ) {
        id
        owner {
          id
        }
        pairToken {
          marketId
        }
        pairAmountPar
        tokenSpent
        startTimestamp
        duration
        endTimestamp
        status
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        blockNumber,
        timestamp: expirationTimestampWithBuffer.toString(),
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlLiquidityMiningVestingPositionsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const liquidityMiningVestingPositions = (result.data.liquidityMiningVestingPositions as any[]).map<ApiLiquidityMiningVestingPosition>(
    position => {
      return {
        id: position.id,
        effectiveUser: position.owner.id.toLowerCase(),
        amountPar: new BigNumber(position.pairAmountPar),
        marketId: new BigNumber(position.pairToken.marketId).toNumber(),
        oTokenAmount: new BigNumber(position.oTokenAmount),
        otherTokenSpent: new BigNumber(position.tokenSpent),
        startTimestamp: position.startTimestamp,
        duration: parseInt(position.duration, 10),
        endTimestamp: position.endTimestamp,
        status: ApiLiquidityMiningVestingPositionStatus.ACTIVE,
      };
    },
  );

  return { liquidityMiningVestingPositions };
}

export async function getUnfulfilledLevelUpdateRequests(
  blockNumber: number,
): Promise<{ requests: ApiLiquidityMiningLevelUpdateRequest[] }> {
  const query = `
    query getActiveLevelUpdateRequests($blockNumber: Int!) {
      liquidityMiningLevelUpdateRequests(
        first: ${Pageable.MAX_PAGE_SIZE}
        orderBy: id
        orderDirection: asc
        block: { number_gte: $blockNumber }
        where: { isFulfilled: false }
      ) {
        user {
          id
        }
        requestId
      }
    }
`;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        blockNumber,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlLiquidityMiningLevelUpdateRequestsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const requests = result.data.liquidityMiningLevelUpdateRequests.map<ApiLiquidityMiningLevelUpdateRequest>(
    request => {
      return {
        effectiveUser: request.user.id.toLowerCase(),
        requestId: new BigNumber(request.requestId),
      };
    },
  );

  return { requests };
}

export async function getLiquidityPositions(
  blockNumber: number,
  lastId: string,
): Promise<{ ammLiquidityPositions: ApiAmmLiquidityPosition[] }> {
  const query = `
    query getLiquidityPositions($blockNumber: Int, $lastId: ID) {
      ammLiquidityPositions(
        first: ${Pageable.MAX_PAGE_SIZE}
        orderBy: id
        where: { id_gt: $lastId }
        block: { number: $blockNumber }
      ) {
        id
        effectiveUser {
          id
        }
        pair {
          id
        }
        liquidityTokenBalance
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        blockNumber,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlAmmLiquidityPositionsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const ammLiquidityPositions: ApiAmmLiquidityPosition[] = result.data.ammLiquidityPositions.map(ammLiquidityPosition => {
    return {
      id: ammLiquidityPosition.id,
      effectiveUser: ammLiquidityPosition.effectiveUser.id.toLowerCase(),
      balance: new BigNumber(ammLiquidityPosition.liquidityTokenBalance),
      pairAddress: ammLiquidityPosition.pair.id.toLowerCase(),
    }
  });

  return { ammLiquidityPositions };
}

export async function getLiquiditySnapshots(
  startTimestamp: number,
  endTimestamp: number,
  lastId: string,
): Promise<{ snapshots: ApiAmmLiquiditySnapshot[] }> {
  const query = `
    query getAmmLiquidityPositionSnapshots($startTimestamp: Int, $endTimestamp: Int, $lastId: ID) {
      ammLiquidityPositionSnapshots(
        first: ${Pageable.MAX_PAGE_SIZE},
        orderBy: id
        where: { timestamp_gte:  $startTimestamp timestamp_lt: $endTimestamp id_gt: $lastId }
      ) {
        id
        effectiveUser {
          id
        }
        liquidityTokenBalance
        block
        timestamp
        pair {
          id
        }
      }
    }
  `;

  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startTimestamp,
        endTimestamp,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlAmmLiquidityPositionSnapshotsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const snapshots: ApiAmmLiquiditySnapshot[] = result.data.ammLiquidityPositionSnapshots.map(snapshot => {
    return {
      id: snapshot.id,
      effectiveUser: snapshot.effectiveUser.id.toLowerCase(),
      pairAddress: snapshot.pair.id.toLowerCase(),
      block: snapshot.block,
      timestamp: snapshot.timestamp,
      liquidityTokenBalance: snapshot.liquidityTokenBalance,
    }
  });

  return { snapshots };
}

export async function getTrades(
  startBlock: number,
  endBlock: number,
  lastId: string,
): Promise<{ trades: ApiTrade[] }> {
  const query = `
    query getTrades($startBlock: Int, $endBlock: Int, $lastId: ID) {
      trades(
        first: ${Pageable.MAX_PAGE_SIZE},
        orderBy: id
        where: {
          transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock },
          id_gt: $lastId
        }
      ) {
        ${TRADE_FIELDS_GQL}
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlTradesResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const trades = result.data.trades.map<ApiTrade>(trade => _mapTradeGqlToApiTrade(trade));
  return { trades };
}

export async function getTakerTrades(
  startBlock: number,
  endBlock: number,
  lastId: string,
  takerTokenAddress: string,
): Promise<{ trades: ApiTrade[] }> {
  const query = `
    query getTrades($startBlock: Int, $endBlock: Int, $lastId: ID, $takerToken: String) {
      trades(
        first: ${Pageable.MAX_PAGE_SIZE},
        orderBy: id
        where: {
          transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock },
          id_gt: $lastId
          takerToken: $takerToken
        }
      ) {
        ${TRADE_FIELDS_GQL}
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
        takerToken: takerTokenAddress.toLowerCase(),
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlTradesResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const trades = result.data.trades.map<ApiTrade>(trade => _mapTradeGqlToApiTrade(trade));
  return { trades };
}

export async function getMakerTrades(
  startBlock: number,
  endBlock: number,
  lastId: string,
  makerTokenAddress: string,
): Promise<{ trades: ApiTrade[] }> {
  const query = `
    query getTrades($startBlock: Int, $endBlock: Int, $lastId: ID, $makerToken: String) {
      trades(
        first: ${Pageable.MAX_PAGE_SIZE},
        orderBy: id
        where: {
          transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock },
          id_gt: $lastId
          makerToken: $makerToken
        }
      ) {
        ${TRADE_FIELDS_GQL}
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
        makerToken: makerTokenAddress.toLowerCase(),
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlTradesResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const trades = result.data.trades.map<ApiTrade>(trade => _mapTradeGqlToApiTrade(trade));
  return { trades };
}

export async function getTransfers(
  startBlock: number,
  endBlock: number,
  lastId: string,
  tokenAddress?: string,
): Promise<{ transfers: ApiTransfer[] }> {
  const query = `
    query getTransfers($startBlock: Int, $endBlock: Int, $lastId: ID) {
      transfers(
        first: ${Pageable.MAX_PAGE_SIZE},
        orderBy: id
        where: {
          transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }
          id_gt: $lastId
          ${tokenAddress ? `token: "${tokenAddress.toLowerCase()}"` : ''} 
        }
      ) {
        id
        serialId
        transaction {
          timestamp
        }
        amountDeltaWei
        fromAmountDeltaPar
        toAmountDeltaPar
        fromEffectiveUser {
          id
        }
        toEffectiveUser {
          id
        }
        fromMarginAccount {
          user {
            id
          }
          accountNumber
        }
        toMarginAccount {
          user {
            id
          }
          accountNumber
        }
        token {
          marketId
        }
        interestIndex {
          supplyIndex
          borrowIndex
        }
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlTransfersResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const transfers = result.data.transfers.map<ApiTransfer>(transfer => {
    return {
      id: transfer.id,
      serialId: parseInt(transfer.serialId, 10),
      timestamp: parseInt(transfer.transaction.timestamp, 10),
      fromEffectiveUser: transfer.fromEffectiveUser.id.toLowerCase(),
      fromMarginAccount: {
        user: transfer.fromMarginAccount.user.id.toLowerCase(),
        accountNumber: transfer.fromMarginAccount.accountNumber,
      },
      toEffectiveUser: transfer.toEffectiveUser.id.toLowerCase(),
      toMarginAccount: {
        user: transfer.toMarginAccount.user.id.toLowerCase(),
        accountNumber: transfer.toMarginAccount.accountNumber,
      },
      marketId: new BigNumber(transfer.token.marketId).toNumber(),
      amountDeltaWei: new BigNumber(transfer.amountDeltaWei),
      fromAmountDeltaPar: new BigNumber(transfer.fromAmountDeltaPar),
      toAmountDeltaPar: new BigNumber(transfer.toAmountDeltaPar),
      interestIndex: {
        marketId: new BigNumber(transfer.token.marketId).toNumber(),
        borrow: new BigNumber(transfer.interestIndex.borrowIndex),
        supply: new BigNumber(transfer.interestIndex.supplyIndex),
      },
    }
  });

  return { transfers };
}

export async function getVestingPositionTransfers(
  startTimestamp: number,
  endTimestamp: number,
  lastId: string,
): Promise<{ vestingPositionTransfers: ApiVestingPositionTransfer[] }> {
  const query = `
    query getLiquidityMiningVestingPositionTransfers($startTimestamp: BigInt, $endTimestamp: BigInt, $lastId: ID) {
      liquidityMiningVestingPositionTransfers(
        first: ${Pageable.MAX_PAGE_SIZE}
        orderBy: id
        where: { transaction_: { timestamp_gte: $startTimestamp timestamp_lt: $endTimestamp } id_gt: $lastId }
      ) {
        id
        serialId
        transaction {
          timestamp
        }
        fromEffectiveUser {
          id
        }
        toEffectiveUser {
          id
        }
        vestingPosition {
          pairAmountPar
        }
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startTimestamp,
        endTimestamp,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlVestingPositionTransfersResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const vestingPositionTransfers = result.data.liquidityMiningVestingPositionTransfers.map<ApiVestingPositionTransfer>(
    vestingPositionTransfer => {
      return {
        id: vestingPositionTransfer.id,
        serialId: parseInt(vestingPositionTransfer.serialId, 10),
        timestamp: parseInt(vestingPositionTransfer.transaction.timestamp, 10),
        fromEffectiveUser: vestingPositionTransfer.fromEffectiveUser?.id?.toLowerCase(),
        toEffectiveUser: vestingPositionTransfer.toEffectiveUser?.id?.toLowerCase(),
        amount: new BigNumber(vestingPositionTransfer.vestingPosition.pairAmountPar),
      }
    },
  )
    .sort((a, b) => a.timestamp - b.timestamp);

  return { vestingPositionTransfers };
}

export async function getWithdrawals(
  startBlock: number,
  endBlock: number,
  lastId: string,
  tokenAddress?: string,
): Promise<{ withdrawals: ApiWithdrawal[] }> {
  const query = `
    query getWithdrawals($startBlock: Int, $endBlock: Int, $lastId: ID) {
    withdrawals(
      first: ${Pageable.MAX_PAGE_SIZE},
      orderBy: id
      where: {
        transaction_: { blockNumber_gte: $startBlock blockNumber_lt: $endBlock }
        id_gt: $lastId
        ${tokenAddress ? `token: "${tokenAddress.toLowerCase()}"` : ''} 
      }
    ) {
        id
        serialId
        transaction {
          timestamp
        }
        amountDeltaWei
        amountDeltaPar
        token {
          marketId
        }
        marginAccount {
          user {
            id
          }
          accountNumber
        }
        effectiveUser {
          id
        }
        interestIndex {
          supplyIndex
          borrowIndex
        }
      }
    }
  `;
  const result = await axios.post(
    subgraphUrl,
    {
      query,
      variables: {
        startBlock,
        endBlock,
        lastId,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlWithdrawalsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }

  const withdrawals = ((result as GraphqlWithdrawalsResult).data.withdrawals).map<ApiWithdrawal>(withdrawal => {
    return {
      id: withdrawal.id,
      serialId: parseInt(withdrawal.serialId, 10),
      timestamp: parseInt(withdrawal.transaction.timestamp, 10),
      effectiveUser: withdrawal.effectiveUser.id.toLowerCase(),
      marginAccount: {
        user: withdrawal.marginAccount.user.id.toLowerCase(),
        accountNumber: withdrawal.marginAccount.accountNumber,
      },
      marketId: new BigNumber(withdrawal.token.marketId).toNumber(),
      amountDeltaPar: new BigNumber(withdrawal.amountDeltaPar),
      amountDeltaWei: new BigNumber(withdrawal.amountDeltaWei),
      interestIndex: {
        marketId: new BigNumber(withdrawal.token.marketId).toNumber(),
        borrow: new BigNumber(withdrawal.interestIndex.borrowIndex),
        supply: new BigNumber(withdrawal.interestIndex.supplyIndex),
      },
    }
  });

  return { withdrawals };
}

export async function getAllDolomiteAccountsWithSupplyValue(
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $lastId: ID) {
                marginAccounts(
                  where: { hasSupplyValue: true id_gt: $lastId }
                  block: { number: $blockNumber }
                  orderBy: id
                  first: ${Pageable.MAX_PAGE_SIZE}
                ) {
                  id
                  user {
                    id
                    effectiveUser {
                      id
                    }
                  }
                  accountNumber
                  tokenValues {
                    token {
                      id
                      marketId
                      decimals
                      symbol
                    }
                    valuePar
                    expirationTimestamp
                    expiryAddress
                  }
                }
              }`;
  return getAccounts(marketIndexMap, query, blockNumber, lastId);
}

export async function getAllDolomiteAccountsByWalletAddress(
  walletAddress: string,
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $walletAddress: ID, $lastId: ID) {
                marginAccounts(
                  where: { effectiveUser: $walletAddress hasSupplyValue: true id_gt: $lastId }
                  block: { number: $blockNumber }
                  orderBy: id
                  first: ${Pageable.MAX_PAGE_SIZE}
                ) {
                  id
                  user {
                    id
                    effectiveUser {
                      id
                    }
                  }
                  accountNumber
                  tokenValues {
                    token {
                      id
                      marketId
                      decimals
                      symbol
                    }
                    valuePar
                    expirationTimestamp
                    expiryAddress
                  }
                }
              }`;
  return getAccounts(marketIndexMap, query, blockNumber, lastId, { walletAddress });
}

export async function getAllDolomiteAccountsWithToken(
  tokenAddress: string,
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ accounts: ApiAccount[] }> {
  const query = `
            query getActiveMarginAccounts($blockNumber: Int, $token: String, $lastId: ID) {
                marginAccounts(
                  where: { hasSupplyValue: true id_gt: $lastId tokenValues_: { token: $token } }
                  block: { number: $blockNumber }
                  orderBy: id
                  first: ${Pageable.MAX_PAGE_SIZE}
                ) {
                  id
                  user {
                    id
                    effectiveUser {
                      id
                    }
                  }
                  accountNumber
                  tokenValues(where: { token: $token }) {
                    token {
                      id
                      marketId
                      decimals
                      symbol
                    }
                    valuePar
                    expirationTimestamp
                    expiryAddress
                  }
                }
              }`;
  return getAccounts(marketIndexMap, query, blockNumber, lastId, { token: tokenAddress.toLowerCase() });
}

export async function getDolomiteMarkets(
  blockNumber: number,
  lastId: string | undefined,
): Promise<{ markets: ApiMarket[] }> {
  const result: GraphqlMarketResult = await axios.post(
    subgraphUrl,
    {
      query: `query getMarketRiskInfos($blockNumber: Int, $lastId: ID) {
                marketRiskInfos(
                  block: { number: $blockNumber }
                  first: ${Pageable.MAX_PAGE_SIZE}
                  where: { id_gt: $lastId }
                  orderBy: id
                ) {
                  token {
                    id
                    marketId
                    name
                    symbol
                    decimals
                  }
                  marginPremium
                  liquidationRewardPremium
                }
              }`,
      variables: {
        blockNumber,
        lastId: lastId ?? '',
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlMarketResult);

  if (result.errors && typeof result.errors === 'object') {
    // noinspection JSPotentiallyInvalidTargetOfIndexedPropertyAccess
    return Promise.reject(result.errors[0]);
  }

  const filteredMarketRiskInfos = result.data.marketRiskInfos.filter(market => {
    return !isMarketIgnored(parseInt(market.token.marketId, 10));
  });

  // @note: Got rid of oracle price retrieval because it would time out for historical queries

  const markets: Promise<ApiMarket>[] = filteredMarketRiskInfos.map(async market => {
    const marketId = new BigNumber(market.token.marketId)
    const apiMarket: ApiMarket = {
      marketId: marketId.toNumber(),
      decimals: Number(market.token.decimals),
      symbol: market.token.symbol,
      name: market.token.name,
      tokenAddress: market.token.id,
      marginPremium: new BigNumber(decimalToString(market.marginPremium)),
      liquidationRewardPremium: new BigNumber(decimalToString(market.liquidationRewardPremium)),
      oraclePrice: undefined,
    };
    return apiMarket;
  });

  return { markets: await Promise.all(markets) };
}

export async function getDolomiteRiskParams(blockNumber: number): Promise<{ riskParams: ApiRiskParam }> {
  const result = await axios.post(
    subgraphUrl,
    {
      query: `query getDolomiteMargins($blockNumber: Int) {
        dolomiteMargins(block: { number: $blockNumber }) {
          id
          liquidationRatio
          liquidationReward
        }
      }`,
      variables: {
        blockNumber,
      },
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlRiskParamsResult);

  if (result.errors && typeof result.errors === 'object') {
    // noinspection JSPotentiallyInvalidTargetOfIndexedPropertyAccess
    return Promise.reject(result.errors[0]);
  }

  const riskParams: ApiRiskParam[] = result.data.dolomiteMargins.map(riskParam => {
    return {
      dolomiteMargin: ethers.utils.getAddress(riskParam.id),
      liquidationRatio: new BigNumber(decimalToString(riskParam.liquidationRatio)),
      liquidationReward: new BigNumber(decimalToString(riskParam.liquidationReward)),
    };
  });

  return { riskParams: riskParams[0] };
}

export async function getTimestampToBlockNumberMap(timestamps: number[]): Promise<Record<string, number>> {
  let queries = '';
  timestamps.forEach(timestamp => {
    queries += `_${timestamp}:blocks(where: { timestamp_gt: ${timestamp - 30}, timestamp_lt: ${timestamp
    + 30} } first: 1) { number }`
  });
  const result = await axios.post(
    `${process.env.SUBGRAPH_BLOCKS_URL}`,
    {
      query: `query getTimestampToBlockNumberMap {
        ${queries}
      }`,
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlTimestampToBlockResult);

  return timestamps.reduce((memo, timestamp) => {
    memo[timestamp.toString()] = parseInt(result.data[`_${timestamp}`]?.[0]?.number, 10);
    return memo;
  }, {});
}

function _mapGraphqlAccountToApiAccount(
  account: GraphqlAccount,
  marketIndexMap: { [marketId: string]: { borrow: Decimal, supply: Decimal } | undefined },
): ApiAccount | undefined {
  let skip = false;
  const balances = account.tokenValues.reduce<{ [marketNumber: string]: ApiBalance }>((memo, value) => {
    const tokenBase = new BigNumber('10').pow(value.token.decimals);
    const valuePar = new BigNumber(value.valuePar).times(tokenBase);
    const indexObject = marketIndexMap[value.token.marketId];
    if (!indexObject) {
      skip = true;
      return memo;
    }

    const index = valuePar.lt(INTEGERS.ZERO) ? indexObject.borrow : indexObject.supply;
    memo[value.token.marketId] = {
      marketId: Number(value.token.marketId),
      tokenName: value.token.name,
      tokenSymbol: value.token.symbol,
      tokenDecimals: Number.parseInt(value.token.decimals, 10),
      tokenAddress: value.token.id.toLowerCase(),
      par: valuePar,
      wei: valuePar.times(index).integerValue(),
      expiresAt: value.expirationTimestamp ? new BigNumber(value.expirationTimestamp) : null,
      expiryAddress: value.expiryAddress,
    };
    return memo;
  }, {});

  if (skip) {
    return undefined;
  }

  return {
    id: `${account.user.id}-${account.accountNumber}`,
    owner: account.user.id.toLowerCase(),
    number: new BigNumber(account.accountNumber),
    effectiveUser: account.user?.effectiveUser?.id.toLowerCase(),
    balances,
  };
}

function _mapLiquidationGqlToApiLiquidation(liquidation: any): ApiLiquidation {
  return {
    id: liquidation.id,
    serialId: parseInt(liquidation.serialId, 10),
    timestamp: parseInt(liquidation.transaction.timestamp, 10),
    solidEffectiveUser: liquidation.solidEffectiveUser.id.toLowerCase(),
    solidMarginAccount: {
      user: liquidation.solidMarginAccount.user.id.toLowerCase(),
      accountNumber: liquidation.solidMarginAccount.accountNumber,
    },
    liquidEffectiveUser: liquidation.liquidEffectiveUser.id.toLowerCase(),
    liquidMarginAccount: {
      user: liquidation.liquidMarginAccount.user.id.toLowerCase(),
      accountNumber: liquidation.liquidMarginAccount.accountNumber,
    },
    heldMarketId: new BigNumber(liquidation.heldToken.marketId).toNumber(),
    borrowedMarketId: new BigNumber(liquidation.borrowedToken.marketId).toNumber(),
    heldTokenAmountDeltaWei: new BigNumber(liquidation.heldTokenAmountDeltaWei),
    borrowedTokenAmountDeltaWei: new BigNumber(liquidation.borrowedTokenAmountDeltaWei),
    solidHeldTokenAmountDeltaPar: new BigNumber(liquidation.solidHeldTokenAmountDeltaPar),
    liquidHeldTokenAmountDeltaPar: new BigNumber(liquidation.liquidHeldTokenAmountDeltaPar),
    solidBorrowedTokenAmountDeltaPar: new BigNumber(liquidation.solidBorrowedTokenAmountDeltaPar),
    liquidBorrowedTokenAmountDeltaPar: new BigNumber(liquidation.liquidBorrowedTokenAmountDeltaPar),
    heldInterestIndex: {
      marketId: new BigNumber(liquidation.heldToken.marketId).toNumber(),
      borrow: new BigNumber(liquidation.heldInterestIndex.borrowIndex),
      supply: new BigNumber(liquidation.heldInterestIndex.supplyIndex),
    },
    borrowedInterestIndex: {
      marketId: new BigNumber(liquidation.borrowedToken.marketId).toNumber(),
      borrow: new BigNumber(liquidation.borrowedInterestIndex.borrowIndex),
      supply: new BigNumber(liquidation.borrowedInterestIndex.supplyIndex),
    },
  };
}

function _mapTradeGqlToApiTrade(trade: any): ApiTrade {
  return {
    id: trade.id,
    serialId: parseInt(trade.serialId, 10),
    timestamp: parseInt(trade.transaction.timestamp, 10),
    takerEffectiveUser: trade.takerEffectiveUser.id.toLowerCase(),
    takerMarginAccount: {
      user: trade.takerMarginAccount.user.id.toLowerCase(),
      accountNumber: trade.takerMarginAccount.accountNumber,
    },
    takerMarketId: new BigNumber(trade.takerToken.marketId).toNumber(),
    takerTokenDeltaWei: new BigNumber(trade.takerTokenDeltaWei),
    makerTokenDeltaWei: new BigNumber(trade.makerTokenDeltaWei),
    takerInputTokenDeltaPar: new BigNumber(trade.takerInputTokenDeltaPar),
    takerOutputTokenDeltaPar: new BigNumber(trade.takerOutputTokenDeltaPar),
    makerInputTokenDeltaPar: new BigNumber(trade.makerInputTokenDeltaPar),
    makerOutputTokenDeltaPar: new BigNumber(trade.makerOutputTokenDeltaPar),
    makerEffectiveUser: trade.makerEffectiveUser ? trade.makerEffectiveUser.id.toLowerCase() : null,
    makerMarginAccount: trade.makerMarginAccount ? {
      user: trade.makerMarginAccount.user.id.toLowerCase(),
      accountNumber: trade.makerMarginAccount.accountNumber,
    } : undefined,
    makerMarketId: new BigNumber(trade.makerToken.marketId).toNumber(),
    makerInterestIndex: {
      marketId: new BigNumber(trade.makerToken.marketId).toNumber(),
      borrow: new BigNumber(trade.makerInterestIndex.borrowIndex),
      supply: new BigNumber(trade.makerInterestIndex.supplyIndex),
    },
    takerInterestIndex: {
      marketId: new BigNumber(trade.takerToken.marketId).toNumber(),
      borrow: new BigNumber(trade.takerInterestIndex.borrowIndex),
      supply: new BigNumber(trade.takerInterestIndex.supplyIndex),
    },
  };
}
