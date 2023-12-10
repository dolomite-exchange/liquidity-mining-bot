/* eslint-disable import/no-extraneous-dependencies */
import { Integer } from '@dolomite-exchange/dolomite-margin';
import Deploments from '@dolomite-exchange/dolomite-margin-modules/scripts/deployments.json';
import { TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import { DateTime } from 'luxon';
import { ApiAccount, ApiLiquidityMiningVestingPosition } from '../lib/api-types';
import Logger from '../lib/logger';
import { dolomite } from './web3';
import VesterExploderAbi from '../abi/vester-exploder.json';
import VesterProxyAbi from '../abi/vester-proxy.json';

const network = process.env.NETWORK_ID;
const FOUR_WEEKS = 86_400 * 7;

export async function detonateAccount(
  liquidAccount: ApiAccount,
  position: ApiLiquidityMiningVestingPosition,
  lastBlockTimestamp: DateTime,
): Promise<TxResult | undefined> {
  if (process.env.DETONATIONS_ENABLED !== 'true') {
    return undefined;
  }

  Logger.info({
    at: 'dolomite-helpers#detonateAccount',
    message: 'Starting account detonation',
    accountOwner: liquidAccount.owner,
    accountNumber: liquidAccount.number,
  });

  const expirationTimestamp = position.startTimestamp + position.duration + FOUR_WEEKS;
  const isDetonatable = lastBlockTimestamp.toSeconds() > expirationTimestamp;
  if (!isDetonatable) {
    Logger.info({
      at: 'dolomite-helpers#detonateAccount',
      message: 'Account is not detonatable',
      accountOwner: liquidAccount.owner,
      accountNumber: liquidAccount.number,
    });

    return undefined;
  }

  const detonationContract = new dolomite.web3.eth.Contract(
    VesterExploderAbi,
    Deploments.VesterExploder[network].address,
  );
  return dolomite.contracts.callContractFunction(
    detonationContract.methods.explodePosition(position.id),
  );
}

export async function fulfillLevelUpdateRequest(
  account: ApiAccount,
  requestId: Integer,
  level: number,
): Promise<TxResult | undefined> {
  if (process.env.LEVEL_REQUESTS_ENABLED !== 'true') {
    return undefined;
  }

  Logger.info({
    at: 'dolomite-helpers#detonateAccount',
    message: 'Starting level update request fulfillment',
    accountOwner: account.owner,
    accountNumber: account.number,
  });

  const vesterContract = new dolomite.web3.eth.Contract(
    VesterProxyAbi,
    Deploments.VesterProxy[network].address,
  );
  return dolomite.contracts.callContractFunction(
    vesterContract.methods.handlerUpdateLevel(requestId.toFixed(), account.owner, level),
  );
}
