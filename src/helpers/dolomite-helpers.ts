/* eslint-disable import/no-extraneous-dependencies */
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import { BigNumber, Decimal, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import axios from 'axios';
import { DateTime } from 'luxon';
import VesterExploderAbi from '../abi/vester-exploder.json';
import VesterProxyAbi from '../abi/vester-proxy.json';
import {
  ApiLiquidityMiningLevelUpdateRequest,
  ApiLiquidityMiningVestingPosition,
  ApiMarket,
  MarketIndex,
} from '../lib/api-types';
import Logger from '../lib/logger';
import { dolomite } from './web3';
import { getAllDolomiteAccountsByWalletAddress } from '../clients/dolomite';

const network = process.env.NETWORK_ID as string;

export async function detonateAccount(
  position: ApiLiquidityMiningVestingPosition,
  lastBlockTimestamp: DateTime,
  detonationWindowSeconds: number,
): Promise<TxResult | undefined> {
  if (process.env.DETONATIONS_ENABLED !== 'true') {
    return undefined;
  }

  Logger.info({
    at: 'dolomite-helpers#detonateAccount',
    message: 'Starting account detonation',
    accountOwner: position.effectiveUser,
  });

  const expirationTimestamp = position.startTimestamp + position.duration + detonationWindowSeconds;
  const isExplodable = lastBlockTimestamp.toSeconds() > expirationTimestamp;
  if (!isExplodable) {
    Logger.info({
      at: 'dolomite-helpers#detonateAccount',
      message: 'Account is not explodable',
      accountOwner: position.effectiveUser,
      positionId: position.id,
    });

    return undefined;
  }

  const detonationContract = new dolomite.web3.eth.Contract(
    VesterExploderAbi,
    ModuleDeployments.VesterExploder[network].address,
  );
  return dolomite.contracts.callContractFunction(
    detonationContract.methods.explodePosition(position.id),
  );
}

export async function fulfillLevelUpdateRequest(
  request: ApiLiquidityMiningLevelUpdateRequest,
  marketMap: { [marketId: string]: ApiMarket },
  marketIndexMap: { [marketId: string]: MarketIndex },
  blockNumber: number,
): Promise<TxResult | undefined> {
  if (process.env.LEVEL_REQUESTS_ENABLED !== 'true') {
    return undefined;
  }

  let level = await fetchLevelByUser(request.effectiveUser);
  let totalSupplyValueUsd: Decimal | undefined;
  if (level < 4) {
    const { accounts } = await getAllDolomiteAccountsByWalletAddress(
      request.effectiveUser,
      marketIndexMap,
      blockNumber,
      '',
    );

    const oneDollar = new BigNumber('1000000000000000000000000000000000000');
    totalSupplyValueUsd = accounts.reduce((acc, account) => {
      const totalSupplyBalancesUsd = Object.values(account.balances).reduce((acc2, balance) => {
        if (balance.wei.lte(INTEGERS.ZERO)) {
          return acc2;
        }

        const oraclePrice = marketMap[balance.marketId].oraclePrice!;
        const balanceUsd = balance.wei.times(oraclePrice).div(oneDollar);
        return acc2.plus(balanceUsd);
      }, INTEGERS.ZERO);

      return acc.plus(totalSupplyBalancesUsd);
    }, INTEGERS.ZERO);

    if (totalSupplyValueUsd.gt(100_000)) {
      level = 4;
    }
  }

  Logger.info({
    at: 'dolomite-helpers#detonateAccount',
    message: 'Starting level update request fulfillment',
    accountOwner: request.effectiveUser,
    requestId: request.requestId.toFixed(),
    equity: totalSupplyValueUsd?.toFixed(2),
    level,
  });

  const vesterContract = new dolomite.web3.eth.Contract(
    VesterProxyAbi,
    ModuleDeployments.VesterProxy[network].address,
  );
  return dolomite.contracts.callContractFunction(
    vesterContract.methods.handlerUpdateLevel(request.requestId.toFixed(), request.effectiveUser, level),
  );
}

export async function fetchLevelByUser(user: string): Promise<number> {
  return axios.get(`https://verification.dolomite.io/level/${user}`)
    .then(response => response.data.level as number);
}
