import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { getTimestampToBlockNumberMap } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { isScript, shouldForceUpload } from '../src/lib/env';
import Logger from '../src/lib/logger';
import { PENDLE_TREASURY_ADDRESS } from '../src/lib/pendle/configuration';
import {
  getMineralFinalizedFileNameWithPath,
  getMineralMetadataFileNameWithPath,
  getMineralYtConfigFileNameWithPath,
  MINERAL_SEASON,
  writeMineralYtConfigToGitHub,
} from './lib/config-helper';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import { BLACKLIST_ADDRESSES, calculateMerkleRootAndProofs } from './lib/rewards';
import { fetchPendleYtUserBalanceSnapshotBatch } from '../src/lib/pendle/fetcher';
import { MineralEpochMetadata } from './calculate-mineral-rewards';
import { MineralYtConfigFile, MineralYtOutputFile } from './lib/data-types';

/* eslint-enable */

interface UserMineralAllocation {
  /**
   * The amount of minerals earned by the user
   */
  amount: Integer;
}

const ONE_WEEK_SECONDS = 86_400 * 7;
const FETCH_FREQUENCY = 60 * 60; // one hour in seconds
const WEEK_DURATION_FOR_FETCHES = ONE_WEEK_SECONDS;
const ONE_MINERAL_IN_WEI = new BigNumber('1000000000000000000');

export async function calculateMineralYtRewards(
  epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
): Promise<{ epoch: number, merkleRoot: string | null }> {
  const networkId = dolomite.networkId;
  const mineralYtConfigFile = await readFileFromGitHub<MineralYtConfigFile>(
    getMineralYtConfigFileNameWithPath(networkId),
  );
  if (Number.isNaN(epoch) || !mineralYtConfigFile.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const {
    startBlockNumber,
    startTimestamp,
    endTimestamp,
    endBlockNumber,
    isTimeElapsed,
    boostedMultiplier,
    marketId,
  } = mineralYtConfigFile.epochs[epoch];

  if (isTimeElapsed && !isScript()) {
    // If this epoch is finalized, and we're not in a script, return.
    Logger.info({
      at: 'calculateMineralRewards',
      message: `Epoch ${epoch} has passed and merkle root was generated, skipping...`,
    });
    return Promise.resolve({ epoch, merkleRoot: null });
  }

  if (new BigNumber(marketId).isNaN()) {
    return Promise.reject(new Error(`marketId is invalid: ${marketId}`));
  }

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'Mineral YT rewards data',
    blacklistAddresses: BLACKLIST_ADDRESSES,
    blockRewardStart: startBlockNumber,
    blockRewardStartTimestamp: startTimestamp,
    blockRewardEnd: endBlockNumber,
    blockRewardEndTimestamp: endTimestamp,
    dolomiteMargin: libraryDolomiteMargin,
    epochNumber: epoch,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    isTimeElapsed,
    marketId: marketId,
    multiplier: boostedMultiplier,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  const { mineralOutputFile, mineralFileName } = await getOrCreateMineralOutputFile(
    networkId,
    epoch,
    startBlockNumber,
    startTimestamp,
    endBlockNumber,
    endTimestamp,
    boostedMultiplier,
    mineralYtConfigFile.epochs[epoch].marketId,
  );

  const maxTimestamp = Math.min(startTimestamp + WEEK_DURATION_FOR_FETCHES, Math.floor(Date.now() / 1000));
  const numberOfTimestampsToFetch = Math.floor(
    (maxTimestamp - mineralOutputFile.metadata.syncTimestamp) / FETCH_FREQUENCY,
  );
  if (numberOfTimestampsToFetch <= 0) {
    Logger.warn({
      message: 'Skipping fetch, since the number of required fetches is <= 0',
    })
  }
  const timestamps = Array.from(
    { length: numberOfTimestampsToFetch },
    (_, i) => mineralOutputFile.metadata.syncTimestamp + (FETCH_FREQUENCY * i),
  );
  const blockNumbers = Object.values(await getTimestampToBlockNumberMap(timestamps));

  mineralOutputFile.metadata.syncTimestamp = timestamps[timestamps.length - 1];
  mineralOutputFile.metadata.syncBlockNumber = blockNumbers[blockNumbers.length - 1];

  const userToBalanceMapForBlockNumbers = await fetchPendleYtUserBalanceSnapshotBatch(marketId, blockNumbers);

  const mineralsPerUnit = ONE_MINERAL_IN_WEI.times(mineralYtConfigFile.epochs[epoch].marketIdReward).integerValue();
  const userToMineralsMaps = userToBalanceMapForBlockNumbers.map(userRecord => {
    return calculateFinalMinerals(userRecord, boostedMultiplier, mineralsPerUnit);
  });

  userToMineralsMaps.forEach(userToMineralsMap => {
    Object.keys(userToMineralsMap).forEach(user => {
      const pendleTreasuryAmount = userToMineralsMap[PENDLE_TREASURY_ADDRESS!] ?? { amount: INTEGERS.ZERO };
      const mineralsAmount = userToMineralsMap[user].amount;
      const timeWeightedBalance = mineralsAmount.times(FETCH_FREQUENCY).dividedToIntegerBy(ONE_WEEK_SECONDS);

      const mineralsForUser = timeWeightedBalance.times(97).dividedToIntegerBy(100);
      const mineralsForPendle = timeWeightedBalance.times(3).dividedToIntegerBy(100);

      userToMineralsMap[PENDLE_TREASURY_ADDRESS!] = { amount: pendleTreasuryAmount.amount.plus(mineralsForPendle) };
      userToMineralsMap[user].amount = mineralsForUser;
    });
  });

  userToMineralsMaps.forEach(userToMineralsMap => {
    Object.keys(userToMineralsMap).forEach(user => {
      if (!mineralOutputFile.users[user]) {
        mineralOutputFile.users[user] = {
          amount: '0',
          proofs: [],
        };
      }

      const originalUserAmount = new BigNumber(mineralOutputFile.users[user].amount);
      const originalTotalAmount = new BigNumber(mineralOutputFile.metadata.totalAmount);
      const amountToAdd = userToMineralsMap[user].amount;

      if (amountToAdd.gt(INTEGERS.ZERO)) {
        mineralOutputFile.users[user].amount = originalUserAmount.plus(amountToAdd).toFixed(0);
        mineralOutputFile.metadata.totalAmount = originalTotalAmount.plus(amountToAdd).toFixed(0);
      } else if (originalUserAmount.eq(INTEGERS.ZERO)) {
        delete mineralOutputFile.users[user];
      }
    });
  });

  mineralOutputFile.metadata.totalUsers = Object.keys(mineralOutputFile.users).length;

  if (isTimeElapsed) {
    const userToAmountMap = Object.keys(mineralOutputFile.users).reduce((memo, k) => {
      memo[k] = new BigNumber(mineralOutputFile.users[k].amount);
      return memo;
    }, {} as Record<string, Integer>);
    const {
      merkleRoot: calculatedMerkleRoot,
      walletAddressToLeavesMap,
    } = calculateMerkleRootAndProofs(userToAmountMap);

    Object.keys(mineralOutputFile.users).forEach((user) => {
      mineralOutputFile.users[user] = {
        amount: walletAddressToLeavesMap[user].amount,
        proofs: walletAddressToLeavesMap[user].proofs,
      }
    });
    mineralOutputFile.metadata.merkleRoot = calculatedMerkleRoot;
  }

  if (!isScript() || shouldForceUpload()) {
    await writeFileToGitHub(mineralFileName, mineralOutputFile, false);
  } else {
    Logger.info({
      message: 'Skipping output file upload due to script execution',
    });
    writeOutputFile(`mineral-${networkId}-season-${MINERAL_SEASON}-epoch-${epoch}-output.json`, mineralOutputFile);
  }

  if ((!isScript() || shouldForceUpload()) && mineralOutputFile.metadata.merkleRoot) {
    mineralYtConfigFile.epochs[epoch].isMerkleRootGenerated = true;
    await writeMineralYtConfigToGitHub(mineralYtConfigFile, mineralYtConfigFile.epochs[epoch]);
  } else if (mineralOutputFile.metadata.merkleRoot) {
    Logger.info({
      message: 'Skipping config file upload due to script execution',
    });
    mineralYtConfigFile.epochs[epoch].isMerkleRootGenerated = true;
    writeOutputFile(`mineral-${networkId}-season-${MINERAL_SEASON}-epoch-${epoch}-config.json`, mineralYtConfigFile, 2);
  }

  const metadataFilePath = getMineralMetadataFileNameWithPath(networkId);
  const metadata = await readFileFromGitHub<MineralEpochMetadata>(metadataFilePath);

  // Once the merkle root is written, update the metadata to the new highest epoch that is finalized
  if ((!isScript() || shouldForceUpload()) && metadata.pendleMetadata.maxEpochNumber < epoch) {
    metadata.pendleMetadata.maxEpochNumber = epoch;
    await writeFileToGitHub(metadataFilePath, metadata, true);
  } else if (metadata.pendleMetadata.maxEpochNumber < epoch) {
    Logger.info({
      message: 'Skipping config file upload due to script execution',
    });
    metadata.pendleMetadata.maxEpochNumber = epoch;
    writeOutputFile(`mineral-${networkId}-season-${MINERAL_SEASON}-metadata.json`, metadata, 2);
  }

  return { epoch, merkleRoot: mineralOutputFile.metadata.merkleRoot };
}

async function getOrCreateMineralOutputFile(
  networkId: number,
  epoch: number,
  startBlockNumber: number,
  startTimestamp: number,
  endBlockNumber: number,
  endTimestamp: number,
  boostedMultiplier: string,
  marketId: number,
): Promise<{ mineralOutputFile: MineralYtOutputFile, mineralFileName: string }> {
  const mineralFileName = getMineralFinalizedFileNameWithPath(networkId, epoch);
  try {
    return {
      mineralFileName,
      mineralOutputFile: await readFileFromGitHub<MineralYtOutputFile>(mineralFileName),
    };
  } catch (e) {
    return {
      mineralFileName,
      mineralOutputFile: {
        users: {},
        metadata: {
          epoch,
          merkleRoot: null,
          startTimestamp,
          syncTimestamp: startTimestamp,
          endTimestamp,
          startBlockNumber,
          syncBlockNumber: startBlockNumber,
          endBlockNumber,
          boostedMultiplier,
          totalAmount: '0',
          totalUsers: 0,
          marketId,
        },
      },
    };
  }
}

function calculateFinalMinerals(
  userToBalanceMap: Record<string, Decimal>,
  boostedMultiplier: string,
  mineralsPerUnit: Integer,
): Record<string, UserMineralAllocation> {
  return Object.keys(userToBalanceMap).reduce((memo, user) => {
    memo[user] = {
      amount: userToBalanceMap[user].times(boostedMultiplier).times(mineralsPerUnit).integerValue(),
    };
    return memo;
  }, {} as Record<string, UserMineralAllocation>);
}

if (isScript()) {
  calculateMineralYtRewards()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while starting:', error);
      process.exit(1);
    });
}
