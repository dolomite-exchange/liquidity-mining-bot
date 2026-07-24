import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { isScript, shouldForceUpload } from '../src/lib/env';
import Logger from '../src/lib/logger';
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

/*
 * ─── One-time remediation: restore retired-network oDOLO cumulatives ─────────
 *
 * The aggregated oDOLO leaf a user claims against is the SUM of their per-network
 * cumulative amounts, and the on-chain `ODoloRollingClaims` contract treats that
 * leaf as a cumulative (it pays `leaf - userToClaimAmount[user]`). So the leaf
 * must be monotonically non-decreasing per user, or anyone who already claimed
 * the higher amount is left with a negative claimable and cannot claim again.
 *
 * When a network is removed from `allChainWeights` its per-epoch files stop being
 * produced and `calculate-odolo-aggregate-rewards` stops summing it — retroactively
 * erasing that network's entire historical cumulative from every user. That is
 * exactly what happened to Botanix (chain 3637), dropped after epoch 60: 173
 * wallets lost ~2.24M oDOLO of cumulative, and wallets that had already claimed a
 * Botanix-inclusive amount went negative.
 *
 * This script rebuilds the aggregated file with each retired network's last-known
 * per-user cumulative restored, then recomputes the leaves / merkle root / metadata
 * so the file is internally consistent again (amount === sum(amountPerNetwork)).
 *
 * ── Policy ──
 * This encodes the same "honor already-earned amounts" policy as the aggregator
 * carry-forward fix: every wallet keeps the full cumulative it had accrued on the
 * retired network (frozen at `lastEpoch`), which is always >= anything it could
 * have claimed. The alternative policy — "void the retired network except where
 * already claimed" — would instead floor each wallet at its on-chain
 * `userToClaimAmount(wallet)` (read from the ODoloRollingClaims contract), leaving
 * non-claimers with the network excluded. That is more surgical but requires
 * on-chain reads and permanently caps claimers at what they claimed. Pick the
 * policy deliberately before running live; this script implements the former.
 *
 * ── Rollout (important) ──
 * `ODoloMerkleTreeUpdater` only pushes a new root on-chain when the file's epoch is
 * exactly `onchainEpoch + 1`. It will NOT re-push a root for the current epoch, so
 * committing a recomputed root at the current epoch would leave the on-chain root
 * stale and the new proofs unclaimable. Roll this out through the NORMAL pipeline
 * instead: land the aggregator carry-forward fix, commit this restored breakdown so
 * it becomes the `previousFile` the aggregator reads, and let the next scheduled
 * aggregation produce epoch N+1 (with the retired network summed back in) whose root
 * propagates on-chain the usual way. This script therefore DEFAULTS TO A DRY RUN,
 * writing to `scripts/output/` for review, and only writes to GitHub when
 * `shouldForceUpload()` is set. It never sends an on-chain transaction.
 */

const ODOLO_TYPE = OTokenType.oDOLO;

/**
 * Networks removed from `allChainWeights` while users still held a cumulative
 * oDOLO balance on them, with the last epoch a finalized per-network file exists.
 * Add an entry here for any future retirement that needs reconciling.
 */
const RETIRED_NETWORKS: { chainId: ChainId; lastEpoch: number }[] = [
  // Botanix — dropped from allChainWeights after epoch 60 (data commit 09e17e42e6).
  { chainId: 3637 as ChainId, lastEpoch: 60 },
];

const ONE_ODOLO_IN_WEI = '1000000000000000000';

/**
 * Reads a user's per-network cumulative out of an aggregated file entry.
 * `amountPerNetwork` is declared as `{ [network]: { amount } }` but is actually
 * written (and read by the frontend) as a flat `{ [network]: string }` — tolerate
 * both shapes.
 */
function readAggregatePerNetworkAmount(
  amountPerNetwork: ODoloAggregateUserData['amountPerNetwork'],
  chainId: string,
): Integer {
  const raw = (amountPerNetwork ?? {})[chainId] as unknown;
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

export async function rectifyODoloRewardsForRetiredNetworks(): Promise<{
  merkleRoot: string;
  affectedUsers: number;
}> {
  const networkId = dolomite.networkId;
  const aggregatedFileName = getODoloAggregatedFileNameWithPath(networkId);
  const aggregatedFile = await readFileFromGitHub<ODoloAggregateOutputFile>(aggregatedFileName);

  // 1) Rebuild the per-(network, user) cumulative map from the current aggregated
  //    file — this is the set of active networks still being summed.
  const chainToUserToAmount: Record<string, Record<string, string>> = {};
  Object.keys(aggregatedFile.users).forEach(user => {
    const perNetwork = aggregatedFile.users[user].amountPerNetwork ?? {};
    Object.keys(perNetwork).forEach(chainId => {
      if (!chainToUserToAmount[chainId]) {
        chainToUserToAmount[chainId] = {};
      }
      chainToUserToAmount[chainId][user] = readAggregatePerNetworkAmount(
        aggregatedFile.users[user].amountPerNetwork,
        chainId,
      ).toFixed();
    });
  });

  // 2) Overlay each retired network's last-known per-user cumulative (take a max so
  //    a network that is somehow still partially present is never reduced).
  const affectedUsers = new Set<string>();
  let restoredTotal = INTEGERS.ZERO;
  for (let i = 0; i < RETIRED_NETWORKS.length; i += 1) {
    const { chainId, lastEpoch } = RETIRED_NETWORKS[i];
    const key = chainId.toString();
    // eslint-disable-next-line no-await-in-loop
    const retiredFile = await readFileFromGitHub<ODoloOutputFile>(
      getOTokenFinalizedFileNameWithPath(chainId, ODOLO_TYPE, lastEpoch),
    );
    if (!chainToUserToAmount[key]) {
      chainToUserToAmount[key] = {};
    }
    Object.keys(retiredFile.users).forEach(user => {
      const frozen = new BigNumber(retiredFile.users[user].amount);
      const existing = new BigNumber(chainToUserToAmount[key][user] ?? INTEGERS.ZERO.toFixed());
      const restored = frozen.gt(existing) ? frozen : existing;
      if (restored.gt(existing)) {
        affectedUsers.add(user);
        restoredTotal = restoredTotal.plus(restored.minus(existing));
      }
      chainToUserToAmount[key][user] = restored.toFixed();
    });
  }

  // 3) Fold the reconciled per-network cumulatives into per-user totals + metadata.
  const userToAmount: Record<string, Integer> = {};
  const metadataPerNetwork: Record<string, ODoloMetadataPerNetwork> = {};
  Object.keys(chainToUserToAmount).forEach(chainId => {
    const usersOnNetwork = chainToUserToAmount[chainId];
    let networkAmount = INTEGERS.ZERO;
    Object.keys(usersOnNetwork).forEach(user => {
      const amount = new BigNumber(usersOnNetwork[user]);
      networkAmount = networkAmount.plus(amount);
      userToAmount[user] = (userToAmount[user] ?? INTEGERS.ZERO).plus(amount);
    });
    metadataPerNetwork[chainId] = {
      totalUsers: Object.keys(usersOnNetwork).length,
      amount: networkAmount.toFixed(),
    };
  });

  // 4) Recompute the merkle tree over the corrected totals and reassemble the file.
  let cumulativeODolo = INTEGERS.ZERO;
  const { merkleRoot, walletAddressToLeafMap } = await calculateMerkleRootAndLeafs(userToAmount);
  const users = Object.keys(walletAddressToLeafMap).reduce((acc, user) => {
    cumulativeODolo = cumulativeODolo.plus(walletAddressToLeafMap[user].amount);
    acc[user] = {
      ...walletAddressToLeafMap[user],
      amountPerNetwork: Object.keys(chainToUserToAmount).reduce((inner, chain) => {
        inner[chain] = chainToUserToAmount[chain][user] ?? INTEGERS.ZERO.toFixed();
        return inner;
      }, {}),
    };
    return acc;
  }, {} as Record<string, ODoloAggregateUserData>);

  const outputFile: ODoloAggregateOutputFile = {
    users,
    metadata: {
      ...aggregatedFile.metadata,
      totalUsers: Object.keys(walletAddressToLeafMap).length,
      cumulativeODolo: cumulativeODolo.toFixed(),
      merkleRoot,
      metadataPerNetwork,
    },
  };

  Logger.info({
    at: __filename,
    message: 'Rectified oDOLO aggregated rewards for retired networks',
    retiredNetworks: RETIRED_NETWORKS.map(n => n.chainId),
    epoch: outputFile.metadata.epoch,
    affectedUsers: affectedUsers.size,
    restoredODolo: restoredTotal.div(ONE_ODOLO_IN_WEI).toFixed(),
    oldMerkleRoot: aggregatedFile.metadata.merkleRoot,
    newMerkleRoot: merkleRoot,
  });

  if (shouldForceUpload()) {
    await writeFileToGitHub(aggregatedFileName, outputFile, false);
  } else {
    Logger.info({
      at: __filename,
      message: 'Dry run — writing corrected file to scripts/output instead of GitHub. '
        + 'Set the force-upload env var to commit it.',
    });
    writeOutputFile(`odolo/${ODOLO_TYPE}-${networkId}-aggregated-output-rectified.json`, outputFile);
  }

  return { merkleRoot, affectedUsers: affectedUsers.size };
}

if (isScript()) {
  rectifyODoloRewardsForRetiredNetworks()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
