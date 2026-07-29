import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { ODoloRollingClaimsProxy } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { ethers } from 'ethers';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { isScript, shouldForceUpload } from '../src/lib/env';
import Logger from '../src/lib/logger';
import ODoloRollingClaimsAbi from '../src/abi/odolo-reward-distributor.json';
import { getODoloAggregatedFileNameWithPath, getOTokenFinalizedFileNameWithPath } from './lib/config-helper';
import { ODoloAggregateOutputFile, ODoloOutputFile, OTokenType } from './lib/data-types';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import { calculateMerkleRootAndLeafs } from './lib/utils';
import { computeCorrectedEpochPoints } from './make-whole-odolo-diluted-market';

/*
 * ─── Correct the record after the epoch-56/63 WBTC dilution ──────────────────
 *
 * Two GMX GM/GLP isolation-mode vaults were transiently mis-indexed with a huge
 * WBTC balance at the epoch-56 and epoch-63 snapshots, so they captured ~the whole
 * 150,164-oDOLO WBTC pool those weeks and every honest WBTC supplier was under-paid.
 * The subgraph has since self-corrected, so RE-COMPUTING those epochs now (current
 * data) yields the correct distribution — the offenders read as dust, honest
 * suppliers get their fair share.
 *
 * Why only epochs 56 and 63 (not the whole chain): each epoch's oDOLO INCREMENT is
 * computed from that epoch's own points, independent of the running cumulative — so
 * only the two anomalous increments are wrong. The published cumulative carries
 * those two errors forward, and the fix is the sum of the two per-user deltas:
 *
 *   netDelta[user] = Σ over {56,63} ( correctIncrement[user] − publishedIncrement[user] )
 *
 * Honest suppliers get a positive delta (make-whole); the two offenders get a large
 * negative delta (clawback). We apply netDelta to the current aggregated cumulative.
 *
 * ── Clawback floor (important) ──
 * oDOLO is a cumulative merkle drop: a user's leaf can never drop below what they
 * already claimed on-chain, or their claimable goes negative. So any user whose
 * corrected leaf would fall below their on-chain `userToClaimAmount` is floored
 * there. `0x557aab…` never withdrew its spurious oDOLO (fully clawed back);
 * `0xd516c9…` already claimed ~118k of it (unrecoverable via merkle — floored at
 * claimed, an off-chain-recovery decision).
 *
 * ── Rollout ──
 * Published epoch 56–63 roots are on-chain and immutable; this does NOT rewrite
 * them. It rewrites the CURRENT aggregated cumulative + root, which the
 * merkle-tree-updater pushes at the next epoch (offchain == onchain+1). For the
 * correction to persist through future aggregations, the same netDelta must also be
 * applied to the current per-network Arbitrum cumulative file (the additive base the
 * next per-network calc builds on) — see PER_NETWORK note in the summary output.
 *
 * DRY RUN by default: writes the correction map + corrected aggregated file to
 * scripts/output for review. Only writes to GitHub when `shouldForceUpload()` is set.
 * Never sends an on-chain transaction. REVIEW THE DRY-RUN NUMBERS before applying.
 *
 * Usage (run with the ARBITRUM env so the recompute reads Arbitrum data):
 *   NETWORK_ID=42161 ODOLO_RECTIFY_EPOCHS=56,63 \
 *     SCRIPT=true npx ts-node scripts/rectify-odolo-diluted-epochs.ts
 */

const ODOLO_TYPE = OTokenType.oDOLO;
const SOURCE_NETWORK = ChainId.ArbitrumOne; // the diluted market (WBTC) lives on Arbitrum
const AGGREGATED_NETWORK = ChainId.Berachain; // oDOLO is aggregated + claimed on Berachain
const AFFECTED_EPOCHS = (process.env.ODOLO_RECTIFY_EPOCHS ?? '56,63')
  .split(',')
  .map(e => parseInt(e.trim(), 10))
  .filter(e => !Number.isNaN(e));
const BERACHAIN_RPCS = ['https://rpc.berachain.com/', 'https://berachain.drpc.org'];

function readUserAmount(file: ODoloOutputFile, user: string): Integer {
  const entry = file.users[user];
  return entry ? new BigNumber(entry.amount) : INTEGERS.ZERO;
}

/** The correct oDOLO increment for an epoch, recomputed from the (now-corrected) data. */
async function correctIncrementsForEpoch(epoch: number): Promise<Record<string, Integer>> {
  const { userToMarketToPointsMap, marketToPointsMap, oTokenRewardWeiMap } = await computeCorrectedEpochPoints(epoch);
  const increments: Record<string, Integer> = {};
  Object.keys(userToMarketToPointsMap).forEach(user => {
    Object.keys(userToMarketToPointsMap[user]).forEach(market => {
      const weight = oTokenRewardWeiMap[market];
      const total = marketToPointsMap[market];
      if (!weight || !total || total.lte(INTEGERS.ZERO)) {
        return;
      }
      const amount = weight.times(userToMarketToPointsMap[user][market]).dividedToIntegerBy(total);
      increments[user] = (increments[user] ?? INTEGERS.ZERO).plus(amount);
    });
  });
  return increments;
}

/** The published (as-shipped) oDOLO increment for an epoch: cumulative[epoch] − cumulative[epoch-1]. */
async function publishedIncrementsForEpoch(epoch: number): Promise<Record<string, Integer>> {
  const current = await readFileFromGitHub<ODoloOutputFile>(
    getOTokenFinalizedFileNameWithPath(SOURCE_NETWORK, ODOLO_TYPE, epoch),
  );
  let previous: ODoloOutputFile | undefined;
  try {
    previous = await readFileFromGitHub<ODoloOutputFile>(
      getOTokenFinalizedFileNameWithPath(SOURCE_NETWORK, ODOLO_TYPE, epoch - 1),
    );
  } catch (e) {
    previous = undefined; // epoch-1 predates the network's start; treat previous as zero
  }
  const increments: Record<string, Integer> = {};
  Object.keys(current.users).forEach(user => {
    const delta = readUserAmount(current, user).minus(previous ? readUserAmount(previous, user) : INTEGERS.ZERO);
    increments[user] = delta;
  });
  return increments;
}

/** On-chain claimed oDOLO (Berachain `userToClaimAmount`) for the given users — the clawback floor. */
async function readOnChainClaimed(users: string[]): Promise<Record<string, Integer>> {
  const claimed: Record<string, Integer> = {};
  if (users.length === 0) {
    return claimed;
  }
  const distributor = ODoloRollingClaimsProxy[AGGREGATED_NETWORK];
  if (!distributor) {
    return Promise.reject(new Error('No ODoloRollingClaimsProxy for the aggregated network'));
  }
  let provider: ethers.providers.JsonRpcProvider | undefined;
  for (let i = 0; i < BERACHAIN_RPCS.length; i += 1) {
    try {
      const candidate = new ethers.providers.JsonRpcProvider(BERACHAIN_RPCS[i]);
      // eslint-disable-next-line no-await-in-loop
      await candidate.getBlockNumber();
      provider = candidate;
      break;
    } catch (e) {
      provider = undefined;
    }
  }
  if (!provider) {
    return Promise.reject(new Error('Could not connect to any Berachain RPC to read userToClaimAmount'));
  }
  const contract = new ethers.Contract(distributor.address, ODoloRollingClaimsAbi as any, provider);
  for (let i = 0; i < users.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await contract.userToClaimAmount(users[i]);
    claimed[users[i]] = new BigNumber(raw.toString()); // already 1e18-scaled wei
  }
  return claimed;
}

export async function rectifyODoloDilutedEpochs(): Promise<void> {
  if (dolomite.networkId !== SOURCE_NETWORK) {
    return Promise.reject(new Error(`Run with NETWORK_ID=${SOURCE_NETWORK} (the diluted market's network) to recompute`));
  }

  // 1) Per-user net delta = Σ over affected epochs of (correct − published) increment.
  const netDelta: Record<string, Integer> = {};
  for (let i = 0; i < AFFECTED_EPOCHS.length; i += 1) {
    const epoch = AFFECTED_EPOCHS[i];
    // eslint-disable-next-line no-await-in-loop
    const correct = await correctIncrementsForEpoch(epoch);
    // eslint-disable-next-line no-await-in-loop
    const published = await publishedIncrementsForEpoch(epoch);
    const users = new Set<string>([...Object.keys(correct), ...Object.keys(published)]);
    users.forEach(user => {
      const delta = (correct[user] ?? INTEGERS.ZERO).minus(published[user] ?? INTEGERS.ZERO);
      if (!delta.eq(INTEGERS.ZERO)) {
        netDelta[user] = (netDelta[user] ?? INTEGERS.ZERO).plus(delta);
      }
    });
  }

  // 2) Read the current aggregated (Berachain) file and, for would-be-lowered users
  //    (the offenders), their on-chain claimed floor.
  const aggregatedFileName = getODoloAggregatedFileNameWithPath(AGGREGATED_NETWORK);
  const aggregated = await readFileFromGitHub<ODoloAggregateOutputFile>(aggregatedFileName);
  const loweredUsers = Object.keys(netDelta).filter(u => netDelta[u].lt(INTEGERS.ZERO));
  const claimedMap = await readOnChainClaimed(loweredUsers);

  // 3) Apply netDelta (Arbitrum-sourced) to each user's aggregated leaf, flooring lowered
  //    users at their on-chain claimed amount so claimable can never go negative.
  const sourceKey = SOURCE_NETWORK.toString();
  const correctionMap: Record<string, { oldAmount: string; delta: string; newAmount: string; flooredAtClaimed: boolean }> = {};
  let clawedBackWei = INTEGERS.ZERO;
  let madeWholeWei = INTEGERS.ZERO;
  let unrecoverableWei = INTEGERS.ZERO;

  Object.keys(netDelta).forEach(user => {
    const entry = aggregated.users[user];
    if (!entry) {
      // A user diluted out of existence should not happen (they held real balances); skip + log.
      Logger.warn({ at: __filename, message: 'netDelta user missing from aggregated file — skipping', user });
      return;
    }
    const oldAmount = new BigNumber(entry.amount);
    let newAmount = oldAmount.plus(netDelta[user]);
    let flooredAtClaimed = false;
    if (netDelta[user].lt(INTEGERS.ZERO)) {
      const claimed = claimedMap[user] ?? INTEGERS.ZERO;
      if (newAmount.lt(claimed)) {
        unrecoverableWei = unrecoverableWei.plus(claimed.minus(newAmount));
        newAmount = claimed;
        flooredAtClaimed = true;
      }
      clawedBackWei = clawedBackWei.plus(oldAmount.minus(newAmount));
    } else {
      madeWholeWei = madeWholeWei.plus(newAmount.minus(oldAmount));
    }

    // Keep amount == Σ(amountPerNetwork): push the whole change onto the source network.
    const perNetwork = entry.amountPerNetwork as unknown as Record<string, string>;
    const oldSource = new BigNumber(perNetwork[sourceKey] ?? INTEGERS.ZERO.toFixed());
    const newSource = oldSource.plus(newAmount.minus(oldAmount));
    perNetwork[sourceKey] = (newSource.lt(INTEGERS.ZERO) ? INTEGERS.ZERO : newSource).toFixed();
    entry.amount = newAmount.toFixed();

    correctionMap[user] = {
      oldAmount: oldAmount.toFixed(),
      delta: netDelta[user].toFixed(),
      newAmount: newAmount.toFixed(),
      flooredAtClaimed,
    };
  });

  // 4) Regenerate the merkle root/leaves + cumulative over the corrected amounts.
  const userToAmount = Object.keys(aggregated.users).reduce((memo, user) => {
    memo[user] = new BigNumber(aggregated.users[user].amount);
    return memo;
  }, {} as Record<string, Integer>);
  const { merkleRoot, walletAddressToLeafMap } = await calculateMerkleRootAndLeafs(userToAmount);
  let cumulativeODolo = INTEGERS.ZERO;
  Object.keys(aggregated.users).forEach(user => {
    aggregated.users[user].leaf = walletAddressToLeafMap[user].leaf;
    cumulativeODolo = cumulativeODolo.plus(aggregated.users[user].amount);
  });
  aggregated.metadata.cumulativeODolo = cumulativeODolo.toFixed();
  const oldRoot = aggregated.metadata.merkleRoot;
  aggregated.metadata.merkleRoot = merkleRoot;

  const oneODolo = new BigNumber(10).pow(18);
  Logger.info({
    at: __filename,
    message: 'Computed oDOLO dilution correction (dry run unless force-upload set)',
    affectedEpochs: AFFECTED_EPOCHS,
    usersCorrected: Object.keys(correctionMap).length,
    madeWholeODolo: madeWholeWei.div(oneODolo).toFixed(2),
    clawedBackODolo: clawedBackWei.div(oneODolo).toFixed(2),
    unrecoverableAlreadyClaimedODolo: unrecoverableWei.div(oneODolo).toFixed(2),
    oldMerkleRoot: oldRoot,
    newMerkleRoot: merkleRoot,
  });

  const summary = {
    metadata: {
      affectedEpochs: AFFECTED_EPOCHS,
      sourceNetwork: SOURCE_NETWORK,
      aggregatedNetwork: AGGREGATED_NETWORK,
      usersCorrected: Object.keys(correctionMap).length,
      madeWholeWei: madeWholeWei.toFixed(),
      clawedBackWei: clawedBackWei.toFixed(),
      unrecoverableAlreadyClaimedWei: unrecoverableWei.toFixed(),
      oldMerkleRoot: oldRoot,
      newMerkleRoot: merkleRoot,
      PER_NETWORK_NOTE: `Apply the same per-user delta to the current finalized/${SOURCE_NETWORK}/odolo per-network `
        + 'cumulative file so the next per-network calc builds on the corrected base; otherwise the additive '
        + 'cumulative re-introduces the error next epoch.',
    },
    corrections: correctionMap,
  };

  if (shouldForceUpload()) {
    await writeFileToGitHub(aggregatedFileName, aggregated, false);
  } else {
    Logger.info({ at: __filename, message: 'Dry run — writing to scripts/output. Set force-upload to commit.' });
    writeOutputFile(`odolo/odolo-${AGGREGATED_NETWORK}-aggregated-output-rectified.json`, aggregated);
    writeOutputFile(`odolo/odolo-dilution-correction-map.json`, summary);
  }
}

if (isScript()) {
  rectifyODoloDilutedEpochs()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
