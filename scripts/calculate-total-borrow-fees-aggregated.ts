import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import VeDoloAbi from '../src/abi/ve-dolo.json';
import { getLatestBlockDataByTimestamp } from '../src/clients/blocks';
import { dolomite } from '../src/helpers/web3';
import { ONE_DOLLAR, ONE_ETH_WEI, ONE_WEEK_SECONDS } from '../src/lib/constants';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import { chunkArray } from '../src/lib/utils';
import { readVeDoloRebateMetadataFromApi } from './lib/api-helpers';
import {
  getBorrowInterestFinalizedFileNameWithPath,
  getTotalBorrowInterestFinalizedFileNameWithPath,
} from './lib/config-helper';
import {
  BorrowFeesPerNetworkOutputFile,
  TotalBorrowFeesMetadataPerUser,
  TotalBorrowFeesOutputFile,
} from './lib/data-types';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';

const DOLO_MARKET_ID = new BigNumber(35); // On Berachain

export async function calculateTotalBorrowFeesAggregated(
  epoch: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
) {
  if (Number.isNaN(epoch)) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  if (dolomite.networkId !== 80094) {
    Logger.error({
      file: __filename,
      message: `Invalid network, expected Berachain, found: ${dolomite.networkId}`,
    });
    return Promise.reject(new Error(`Invalid network, expected Berachain, found: ${dolomite.networkId}`));
  }

  const outputFileName = getTotalBorrowInterestFinalizedFileNameWithPath(epoch);
  let hasFile = false;
  try {
    await readFileFromGitHub<TotalBorrowFeesOutputFile>(outputFileName);
    hasFile = true;
    // eslint-disable-next-line no-empty
  } catch (e) {
  }

  if (hasFile && !shouldForceUpload()) {
    Logger.info({
      file: __filename,
      message: 'Epoch borrow amounts have already been calculated. Returning...',
      epoch,
    });

    return false;
  }

  const serverMetadata = await readVeDoloRebateMetadataFromApi();

  const userToTotalBorrowAmountUsd: Record<string, Decimal> = {};
  const userToChainIdToTotalBorrowAmountUsd: Record<string, Record<string, Decimal>> = {};

  const missingNetworks: number[] = [];
  for (const networkIdString of Object.keys(serverMetadata.allChainRebateInfo)) {
    const networkId = parseInt(networkIdString, 10);
    const startEpoch = serverMetadata.allChainRebateInfo[networkId];
    if (!startEpoch || epoch < startEpoch) {
      continue;
    }

    Logger.info({
      file: __filename,
      message: `Processing network ${networkId}`,
    });

    const borrowFeePerNetworkFileName = getBorrowInterestFinalizedFileNameWithPath(networkId, epoch);
    let borrowAmountFile: BorrowFeesPerNetworkOutputFile;
    try {
      borrowAmountFile = await readFileFromGitHub<BorrowFeesPerNetworkOutputFile>(borrowFeePerNetworkFileName);
    } catch (e) {
      missingNetworks.push(networkId);
      continue;
    }

    for (const user of Object.keys(borrowAmountFile.users)) {
      for (const marketId of Object.keys(borrowAmountFile.users[user])) {
        const amount = new BigNumber(borrowAmountFile.users[user][marketId]);
        if (!userToTotalBorrowAmountUsd[user]) {
          userToTotalBorrowAmountUsd[user] = INTEGERS.ZERO;
        }
        if (!userToChainIdToTotalBorrowAmountUsd[user]) {
          userToChainIdToTotalBorrowAmountUsd[user] = {};
        }
        if (!userToChainIdToTotalBorrowAmountUsd[user][networkId]) {
          userToChainIdToTotalBorrowAmountUsd[user][networkId] = INTEGERS.ZERO;
        }

        const amountUsd = amount.multipliedBy(borrowAmountFile.metadata.marketPrices[marketId]).div(ONE_DOLLAR);
        userToTotalBorrowAmountUsd[user] = userToTotalBorrowAmountUsd[user].plus(amountUsd);
        userToChainIdToTotalBorrowAmountUsd[user][networkId]
          = userToChainIdToTotalBorrowAmountUsd[user][networkId].plus(amountUsd);
      }
    }
  }

  if (missingNetworks.length > 0) {
    Logger.info({
      file: __filename,
      message: 'Missing networks for calculating borrow rebate!',
      networks: missingNetworks,
      epoch: epoch?.toString(),
    });
    return false
  }

  const startTimestamp = serverMetadata.veDoloStartTimestamp + (ONE_WEEK_SECONDS * (epoch - 1));
  const endTimestamp = startTimestamp + ONE_WEEK_SECONDS;
  const endBlockNumber = (await getLatestBlockDataByTimestamp(endTimestamp)).blockNumber;

  const veDolo = new dolomite.web3.eth.Contract(
    VeDoloAbi,
    ModuleDeployments.VotingEscrowProxy[dolomite.networkId].address,
  );

  Logger.info({
    file: __filename,
    message: 'Getting veDOLO balances for all users...',
    userCount: Object.keys(userToTotalBorrowAmountUsd).length,
  });
  let totalBorrowInterestUsd = INTEGERS.ZERO; // Across all users
  const userToTotalVeDoloBalance: Record<string, Integer> = {};

  const userBalanceCalls: { target: string, callData: string }[] = [];
  const users = Object.keys(userToTotalBorrowAmountUsd);
  for (const user of users) {
    userBalanceCalls.push({
      target: veDolo.options.address,
      callData: veDolo.methods.getPastVotes(user, endTimestamp).encodeABI(),
    });

    totalBorrowInterestUsd = totalBorrowInterestUsd.plus(userToTotalBorrowAmountUsd[user]);
  }

  const chunkedCalls = chunkArray(userBalanceCalls, 250);
  Logger.info({
    file: __filename,
    message: `Chunked users into ${chunkedCalls.length} chunks`,
    chunkCount: Object.keys(userToTotalBorrowAmountUsd).length,
  })

  let resultIndex = 0;
  for (const balanceCalls of chunkedCalls) {
    const { results: balanceResults } = await dolomite.multiCall.aggregate(balanceCalls);
    for (const result of balanceResults) {
      const user = users[resultIndex];
      const balance = dolomite.web3.eth.abi.decodeParameter('uint256', result);
      if (!userToTotalVeDoloBalance[user]) {
        userToTotalVeDoloBalance[user] = INTEGERS.ZERO;
      }
      userToTotalVeDoloBalance[user] = userToTotalVeDoloBalance[user].plus(balance.toString());
      resultIndex += 1;
    }
  }

  const doloPrice = await dolomite.getters.getMarketPrice(DOLO_MARKET_ID, { blockNumber: endBlockNumber });

  const borrowAmountOutputFile: TotalBorrowFeesOutputFile = {
    users: Object.keys(userToTotalBorrowAmountUsd).reduce((acc, user) => {
      acc[user] = {
        totalBorrowInterestUsd: userToTotalBorrowAmountUsd[user].times(ONE_ETH_WEI).integerValue().toFixed(0),
        totalVeDoloUsd: userToTotalVeDoloBalance[user].times(doloPrice).div(ONE_ETH_WEI).integerValue().toFixed(0),
        totalBorrowInterestUsdPerNetwork: Object.keys(userToChainIdToTotalBorrowAmountUsd[user])
          .reduce((chainIdToAmountMap, chainId) => {
            chainIdToAmountMap[chainId] = userToChainIdToTotalBorrowAmountUsd[user][chainId]
              .times(ONE_ETH_WEI)
              .integerValue()
              .toFixed(0);

            return chainIdToAmountMap;
          }, {} as Record<string, string>),
      };
      return acc;
    }, {} as Record<string, TotalBorrowFeesMetadataPerUser>),
    metadata: {
      epoch,
      totalUsers: Object.keys(userToTotalBorrowAmountUsd).length,
      totalBorrowInterestUsd: totalBorrowInterestUsd.toFixed(18),
      doloPriceUsd: doloPrice.toFixed(0),
    },
  };

  if (!isScript() || shouldForceUpload()) {
    await writeFileToGitHub(outputFileName, borrowAmountOutputFile, false);
  } else {
    Logger.info({
      file: __filename,
      message: 'Skipping output file upload due to script execution',
    });
    writeOutputFile(outputFileName, borrowAmountOutputFile);
  }

  return true;
}

if (isScript()) {
  calculateTotalBorrowFeesAggregated()
    .then(() => {
      process.exit(0);
    })
    .catch(e => {
      Logger.error({
        file: __filename,
        message: `Error in calculate-borrow-rebate.ts: ${e.message}`,
        error: e,
      });
      process.exit(1);
    });
}
