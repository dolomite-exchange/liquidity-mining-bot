/* eslint-disable import/no-extraneous-dependencies */
import Deploments from '@dolomite-exchange/dolomite-margin-modules/scripts/deployments.json';
import { TxResult } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import axios from 'axios';
import { DateTime } from 'luxon';
import VesterExploderAbi from '../abi/vester-exploder.json';
import VesterProxyAbi from '../abi/vester-proxy.json';
import { ApiLiquidityMiningLevelUpdateRequest, ApiLiquidityMiningVestingPosition } from '../lib/api-types';
import Logger from '../lib/logger';
import { dolomite } from './web3';

const network = process.env.NETWORK_ID as string;
const FOUR_WEEKS = 86_400 * 7 * 4;

export async function detonateAccount(
  position: ApiLiquidityMiningVestingPosition,
  lastBlockTimestamp: DateTime,
): Promise<TxResult | undefined> {
  if (process.env.DETONATIONS_ENABLED !== 'true') {
    return undefined;
  }

  Logger.info({
    at: 'dolomite-helpers#detonateAccount',
    message: 'Starting account detonation',
    accountOwner: position.effectiveUser,
  });

  const expirationTimestamp = position.startTimestamp + position.duration + FOUR_WEEKS;
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
    Deploments.VesterExploder[network].address,
  );
  return dolomite.contracts.callContractFunction(
    detonationContract.methods.explodePosition(position.id),
  );
}

export async function fulfillLevelUpdateRequest(
  request: ApiLiquidityMiningLevelUpdateRequest,
): Promise<TxResult | undefined> {
  if (process.env.LEVEL_REQUESTS_ENABLED !== 'true') {
    return undefined;
  }

  const level = await fetchLevelByUser(request.effectiveUser);

  Logger.info({
    at: 'dolomite-helpers#detonateAccount',
    message: 'Starting level update request fulfillment',
    accountOwner: request.effectiveUser,
    requestId: request.requestId.toFixed(),
    level,
  });

  const vesterContract = new dolomite.web3.eth.Contract(
    VesterProxyAbi,
    Deploments.VesterProxy[network].address,
  );
  return dolomite.contracts.callContractFunction(
    vesterContract.methods.handlerUpdateLevel(request.requestId.toFixed(), request.effectiveUser, level),
  );
}

export async function fetchLevelByUser(user: string): Promise<number> {
  return axios.get(`https://verification.dolomite.io/level/${user}`)
    .then(response => response.data.level as number);
}
