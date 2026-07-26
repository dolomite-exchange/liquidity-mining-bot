import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import { readODoloMetadataFromApi } from './lib/api-helpers';
import { getODoloAggregatedFileNameWithPath, getOTokenFinalizedFileNameWithPath } from './lib/config-helper';
import {
  ODoloAggregateOutputFile,
  ODoloAggregateUserData,
  ODoloMetadataPerNetwork,
  ODoloOutputFile,
  OTokenType,
} from './lib/data-types';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import { calculateMerkleRootAndLeafs } from './lib/utils';

const ODOLO_TYPE = OTokenType.oDOLO;

async function getODoloPerNetworkFiles(
  allNetworks: ChainId[],
  epoch: number,
): Promise<[ChainId, ODoloOutputFile][]> {
  return (
    await Promise.all(
      allNetworks.map(n =>
        readFileFromGitHub<ODoloOutputFile>(getOTokenFinalizedFileNameWithPath(n, ODOLO_TYPE, epoch))
          .then(f => [n, f] as [ChainId, ODoloOutputFile])
          .catch(e => {
            if (e?.response?.status === 404) {
              return undefined;
            }
            return Promise.reject(e);
          }),
      ),
    )
  ).filter((value): value is [ChainId, ODoloOutputFile] => !!value);
}

/**
 * Reads a user's per-network cumulative out of a previous aggregated file entry.
 *
 * `amountPerNetwork` is declared as `{ [network]: { amount } }` but is actually
 * written (and read by the frontend) as a flat `{ [network]: string }`. Tolerate
 * both shapes so carry-forward keeps working regardless of which the on-disk
 * file uses.
 */
function readPreviousPerNetworkAmount(
  amountPerNetwork: ODoloAggregateUserData['amountPerNetwork'],
  chainId: string,
): Integer {
  const raw = amountPerNetwork[chainId] as unknown;
  if (raw === undefined || raw === null) {
    return INTEGERS.ZERO;
  }
  if (typeof raw === 'string') {
    return new BigNumber(raw);
  }
  if (typeof raw === 'object' && typeof (raw as { amount?: string }).amount === 'string') {
    return new BigNumber((raw as { amount: string }).amount);
  }
  return new BigNumber(raw as string);
}

/**
 * Folds the per-network oDOLO files for an epoch into per-user cumulative totals.
 *
 * The aggregated leaf a user claims against is the SUM of their per-network
 * cumulative amounts, and the on-chain `ODoloRollingClaims` contract treats that
 * leaf as a cumulative: it transfers `leaf - userToClaimAmount[user]` and then
 * ratchets `userToClaimAmount[user]` up to `leaf`. That makes the leaf a
 * monotonic quantity — it must never decrease across epochs, or a user who
 * already claimed the higher amount is stranded with a negative claimable and
 * can never claim again.
 *
 * The networks summed are whatever currently has weights in `allChainWeights`.
 * When a network is retired from that config its per-epoch files stop being
 * produced, so summing only the current epoch's files silently drops that
 * network's entire historical cumulative from every user who earned on it (this
 * is exactly what happened when Botanix / chain 3637 was removed after epoch 60).
 * To keep the leaf monotonic we reconcile against the previous aggregated file
 * and take a per-(network, user) MAX:
 *   - a retired network (absent this epoch) keeps its last-known cumulative, and
 *   - an active network whose freshly-computed cumulative regressed (e.g. a
 *     subgraph re-index) is clamped up to its previous value.
 * Because every per-network component is >= its previous value, the summed leaf
 * is guaranteed >= the previous leaf, while `amount` stays exactly equal to the
 * sum of `amountPerNetwork`.
 */
function reduceAllNetworkFilesByUser(
  allFiles: [ChainId, ODoloOutputFile][],
  previousFile: ODoloAggregateOutputFile | undefined,
): {
  userToAmountMap: Record<string, Integer>;
  chainToUserToAmountMap: Record<string, Record<string, string>>;
  metadataPerNetwork: Record<string, ODoloMetadataPerNetwork>
} {
  // 1) Seed each network's per-user cumulative from this epoch's finalized files.
  const chainToUserToAmountMap: Record<string, Record<string, string>> = {};
  allFiles.forEach(([chainId, file]) => {
    chainToUserToAmountMap[chainId] = {};
    Object.keys(file.users).forEach(user => {
      chainToUserToAmountMap[chainId][user] = file.users[user].amount;
    });
  });

  // 2) Carry forward every network the previous aggregation knew about, taking a
  //    per-(network, user) max so no network's cumulative can ever regress.
  if (previousFile) {
    Object.keys(previousFile.users).forEach(user => {
      const previousPerNetwork = previousFile.users[user].amountPerNetwork;
      Object.keys(previousPerNetwork).forEach(chainId => {
        if (!chainToUserToAmountMap[chainId]) {
          chainToUserToAmountMap[chainId] = {};
        }
        const previousAmount = readPreviousPerNetworkAmount(previousPerNetwork, chainId);
        const currentAmount = new BigNumber(chainToUserToAmountMap[chainId][user] ?? INTEGERS.ZERO.toFixed());
        chainToUserToAmountMap[chainId][user] = (currentAmount.gt(previousAmount) ? currentAmount : previousAmount)
          .toFixed();
      });
    });
  }

  // 3) Fold the reconciled per-network cumulatives into per-user totals + metadata.
  const metadataPerNetwork: Record<string, ODoloMetadataPerNetwork> = {};
  const userToAmountMap: Record<string, Integer> = {};
  Object.keys(chainToUserToAmountMap).forEach(chainId => {
    const usersOnNetwork = chainToUserToAmountMap[chainId];
    let networkAmount = INTEGERS.ZERO;
    Object.keys(usersOnNetwork).forEach(user => {
      const userAmount = new BigNumber(usersOnNetwork[user]);
      networkAmount = networkAmount.plus(userAmount);
      userToAmountMap[user] = (userToAmountMap[user] ?? INTEGERS.ZERO).plus(userAmount);
    });
    metadataPerNetwork[chainId] = {
      totalUsers: Object.keys(usersOnNetwork).length,
      amount: networkAmount.toFixed(),
    };
  });

  return {
    chainToUserToAmountMap,
    metadataPerNetwork,
    userToAmountMap,
  };
}

export async function calculateODoloAggregateRewards(
  epochNumber: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
): Promise<{
  epoch: number;
  merkleRoot: string | null
}> {
  const networkId = dolomite.networkId;

  if (Number.isNaN(epochNumber)) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epochNumber}`));
  }

  const oDoloConfig = await readODoloMetadataFromApi(epochNumber);

  const allNetworks = Object.keys(oDoloConfig.allChainWeights)
    .filter(c => Object.values(oDoloConfig.allChainWeights[c]).length > 0)
    .map(c => Number(c) as ChainId);

  const allFiles: [ChainId, ODoloOutputFile][] = await getODoloPerNetworkFiles(allNetworks, epochNumber);

  // The week is over if the block is at the end OR if the next block goes into next week
  const isReadyToPostData = allFiles.length === allNetworks.length;
  if (!isReadyToPostData) {
    // There's nothing to do. The week has not passed yet
    Logger.info({
      file: __filename,
      message: 'Epoch has not passed yet. Returning...',
    });
    return { epoch: epochNumber, merkleRoot: null };
  }

  const oDoloAggregatedFileName = getODoloAggregatedFileNameWithPath(networkId);
  let previousFile: ODoloAggregateOutputFile | undefined;
  if (epochNumber !== 0) {
    previousFile = await readFileFromGitHub<ODoloAggregateOutputFile>(oDoloAggregatedFileName);
    if (previousFile.metadata.epoch !== epochNumber - 1) {
      // There's nothing to do. The epochs do not align
      Logger.info({
        file: __filename,
        message: 'Aggregated output does not match. Returning...',
      });
      return { epoch: epochNumber, merkleRoot: null };
    }
  }

  Logger.info({
    file: __filename,
    message: `DolomiteMargin data for aggregating oDOLO rewards`,
    epochNumber: epochNumber,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  const {
    userToAmountMap: userToOTokenRewards,
    chainToUserToAmountMap,
    metadataPerNetwork,
  } = reduceAllNetworkFilesByUser(allFiles, previousFile);

  // Defense in depth for the monotonic-leaf invariant. The per-network carry
  // forward inside `reduceAllNetworkFilesByUser` already guarantees each user's
  // summed leaf is >= its previous value, so this clamp should never bind. If it
  // ever does, the previous aggregated file's per-network breakdown didn't sum to
  // its stored leaf — surface it loudly and still refuse to ship a decrease that
  // would push a claimed user's claimable negative.
  if (previousFile) {
    Object.keys(previousFile.users).forEach(user => {
      const previousAmount = new BigNumber(previousFile!.users[user].amount);
      const nextAmount = userToOTokenRewards[user] ?? INTEGERS.ZERO;
      if (nextAmount.lt(previousAmount)) {
        Logger.error({
          at: __filename,
          message: 'oDOLO leaf would decrease vs previous epoch; clamping up to previous amount',
          user,
          previousAmount: previousAmount.toFixed(),
          computedAmount: nextAmount.toFixed(),
        });
        throw new Error('oDOLO leaf would decrease vs previous epoch; clamping up to previous amount');
      }
    });
  }

  let totalODolo = INTEGERS.ZERO;
  allFiles.forEach(([_, file]) => {
    totalODolo = totalODolo.plus(file.metadata.totalODolo);
  });

  let cumulativeODolo = INTEGERS.ZERO;
  const { merkleRoot, walletAddressToLeafMap } = await calculateMerkleRootAndLeafs(userToOTokenRewards);
  const walletAddressToUserMap = Object.keys(walletAddressToLeafMap).reduce((acc, user) => {
    cumulativeODolo = cumulativeODolo.plus(walletAddressToLeafMap[user].amount);
    acc[user] = {
      ...walletAddressToLeafMap[user],
      amountPerNetwork: Object.keys(chainToUserToAmountMap).reduce((acc, chain) => {
        acc[chain] = chainToUserToAmountMap[chain][user] ?? INTEGERS.ZERO.toFixed();
        return acc;
      }, {}),
    }
    return acc;
  }, {} as Record<string, ODoloAggregateUserData>);


  const oTokenOutputFile: ODoloAggregateOutputFile = {
    users: walletAddressToUserMap,
    metadata: {
      totalUsers: Object.keys(walletAddressToLeafMap).length,
      totalODolo: totalODolo.toFixed(),
      cumulativeODolo: cumulativeODolo.toFixed(),
      epoch: epochNumber,
      merkleRoot,
      metadataPerNetwork,
    },
  };

  if (!isScript() || shouldForceUpload()) {
    await writeFileToGitHub(oDoloAggregatedFileName, oTokenOutputFile, false);
  } else {
    Logger.info({
      file: __filename,
      message: 'Skipping output file upload due to script execution',
    });
    writeOutputFile(`odolo/${ODOLO_TYPE}-${networkId}-aggregated-output.json`, oTokenOutputFile);
  }

  return { epoch: epochNumber, merkleRoot };
}

if (isScript()) {
  calculateODoloAggregateRewards()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
