import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { getTimestampToBlockNumberMap } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { isScript, shouldForceUpload } from '../src/lib/env';
import Logger from '../src/lib/logger';
import { PENDLE_TREASURY_ADDRESS } from '../src/lib/pendle/configuration';
import { fetchPendleYtUserBalanceSnapshotBatch } from '../src/lib/pendle/main';
import {
  EpochMetadata,
  getMineralFinalizedFileNameWithPath,
  getMineralMetadataFileNameWithPath,
  getMineralYtConfigFileNameWithPath,
  MINERAL_SEASON,
  MineralYtConfigFile,
  MineralYtOutputFile,
  writeMineralYtConfigToGitHub,
} from './lib/config-helper';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import { BLACKLIST_ADDRESSES, calculateMerkleRootAndProofs } from './lib/rewards';

/* eslint-enable */

interface UserMineralAllocation {
  /**
   * The amount of minerals earned by the user
   */
  amount: Integer; // big int
}

const ONE_WEEK_SECONDS = 86_400 * 7;
const ONE_HOUR_SECONDS = 60 * 60;
// Subtract 15 minutes since last fetch occurs at 23:45:00
const WEEK_DURATION_FOR_FETCHES = ONE_WEEK_SECONDS;

export async function calculateMineralRewards(epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10)): Promise<void> {
  const networkId = await dolomite.web3.eth.net.getId();
  const mineralYtConfigFile = await readFileFromGitHub<MineralYtConfigFile>(
    getMineralYtConfigFileNameWithPath(networkId),
  );
  if (Number.isNaN(epoch) || !mineralYtConfigFile.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const {
    startBlockNumber,
    startTimestamp,
    endBlockNumber,
    endTimestamp,
    isTimeElapsed,
    boostedMultiplier,
    marketId,
  } = mineralYtConfigFile.epochs[epoch];

  if (isTimeElapsed) {
    // If this epoch is finalized, and we're not in a script, return.
    Logger.info({
      at: 'calculateMineralRewards',
      message: `Epoch ${epoch} has passed and merkle root was generated, skipping...`,
    });
    return;
  }

  if (new BigNumber(marketId).isNaN()) {
    return Promise.reject(`marketId is invalid: ${marketId}`);
  }

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'Mineral rewards data',
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

  const maxTimestamp = Math.min(startTimestamp + WEEK_DURATION_FOR_FETCHES, Math.floor(Date.now() / 1000));
  const numberOfTimestampsToFetch = Math.floor((maxTimestamp - endTimestamp) / ONE_HOUR_SECONDS);
  if (numberOfTimestampsToFetch <= 0) {
    Logger.warning({
      message: 'Skipping fetch, since the number of required fetches is <= 0',
    })
  }
  const timestamps = Array.from(
    { length: numberOfTimestampsToFetch },
    (_, i) => endTimestamp + (ONE_HOUR_SECONDS * i),
  );
  console.log('timestamps', timestamps[0], timestamps[1], timestamps[2], timestamps[timestamps.length - 1]);

  const blockNumbers = Object.values(await getTimestampToBlockNumberMap(timestamps));

  const userToBalanceMapForBlockNumbers = await fetchPendleYtUserBalanceSnapshotBatch(marketId, blockNumbers);

  const userToMineralsMaps = userToBalanceMapForBlockNumbers.map(userRecord => calculateFinalMinerals(
    userRecord,
    boostedMultiplier,
  ));

  userToMineralsMaps[PENDLE_TREASURY_ADDRESS!] = INTEGERS.ZERO;
  userToMineralsMaps.forEach(userToMineralsMap => {
    Object.keys(userToMineralsMap).forEach(user => {
      const amountToPendle = userToMineralsMap[user].amount.times(3).times(3).dividedToIntegerBy(100);

      userToMineralsMap[PENDLE_TREASURY_ADDRESS!].amount = userToMineralsMap[PENDLE_TREASURY_ADDRESS!].amount.plus(
        amountToPendle);
      userToMineralsMap[user].amount = userToMineralsMap[user].amount.times(3).times(97).dividedToIntegerBy(100);
    });
  });

  const mineralFileName = getMineralFinalizedFileNameWithPath(networkId, epoch);
  let mineralOutputFile: MineralYtOutputFile;
  try {
    mineralOutputFile = await readFileFromGitHub<MineralYtOutputFile>(mineralFileName);
  } catch (e) {
    mineralOutputFile = {
      users: {},
      metadata: {
        epoch,
        merkleRoot: null,
        startTimestamp,
        endTimestamp,
        startBlockNumber,
        endBlockNumber,
        boostedMultiplier,
        totalAmount: '0',
        totalUsers: 0,
        marketId: mineralYtConfigFile.epochs[epoch].marketId,
      },
    };
  }

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

      mineralOutputFile.users[user].amount = originalUserAmount.plus(amountToAdd).toFixed(0);
      mineralOutputFile.metadata.totalAmount = originalTotalAmount.plus(amountToAdd).toFixed(0);
    });
  });

  if (isTimeElapsed) {
    const userToAmountMap = Object.keys(mineralOutputFile.users).reduce((memo, k) => {
      memo[k] = mineralOutputFile.users[k].amount;
      return memo;
    }, {});
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
      message: 'Skipping file upload due to script execution',
    });
    writeOutputFile(`mineral-${networkId}-season-${MINERAL_SEASON}-epoch-${epoch}-output.json`, mineralOutputFile);
  }

  if ((!isScript() || shouldForceUpload()) && mineralOutputFile.metadata.merkleRoot) {
    mineralYtConfigFile.epochs[epoch].isMerkleRootGenerated = true;
    await writeMineralYtConfigToGitHub(mineralYtConfigFile, mineralYtConfigFile.epochs[epoch]);
  }

  const metadataFilePath = getMineralMetadataFileNameWithPath(networkId);
  const metadata = await readFileFromGitHub<EpochMetadata>(metadataFilePath);

  // Once the merkle root is written, update the metadata to the new highest epoch that is finalized
  if (metadata.maxEpochNumber < epoch) {
    metadata.maxEpochNumber = epoch;
    await writeFileToGitHub(metadataFilePath, metadata, true);
  }

  return undefined;
}

function calculateFinalMinerals(
  userToPointsMap: Record<string, Integer>,
  boostedMultiplier: string,
): Record<string, UserMineralAllocation> {
  return Object.keys(userToPointsMap).reduce((memo, user) => {
    memo[user] = {
      amount: userToPointsMap[user].times(boostedMultiplier),
    };
    return memo;
  }, {} as Record<string, UserMineralAllocation>);
}

if (isScript()) {
  calculateMineralRewards()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while starting:', error);
      process.exit(1);
    });
}
