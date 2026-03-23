import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { getLatestBlockDataByTimestamp } from '../src/clients/blocks';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { ONE_DOLLAR, ONE_ETH_WEI, ONE_WEEK_SECONDS } from '../src/lib/constants';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import { readVeDoloRebateMetadataFromApi } from './lib/api-helpers';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import {
  getBorrowInterestFinalizedFileNameWithPath,
  getTotalBorrowInterestFinalizedFileNameWithPath,
} from './lib/config-helper';
import {
  BorrowFeesPerNetworkOutputFile,
  TotalBorrowFeesMetadataPerUser,
  TotalBorrowFeesOutputFile,
} from './lib/data-types';
import VeDoloAbi from '../src/abi/ve-dolo.json';

const DOLO_MARKET_ID = new BigNumber(35); // On Berachain

export async function calculateTotalBorrowFeesAggregated(
  epoch: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
) {
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
  const networks = Object.keys(serverMetadata.allChainStartEpochs).map(c => Number(c)) as ChainId[];

  const userToTotalBorrowAmountUsd: Record<string, Decimal> = {};

  const missingNetworks: number[] = [];
  for (const networkId of networks) {
    const startEpoch = serverMetadata.allChainStartEpochs[networkId];
    if (startEpoch === null || epoch < startEpoch) {
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

        const amountUsd = amount.multipliedBy(borrowAmountFile.metadata.marketPrices[marketId]).div(ONE_DOLLAR);
        userToTotalBorrowAmountUsd[user] = userToTotalBorrowAmountUsd[user].plus(amountUsd);
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

  const startTimestamp = serverMetadata.startTimestamp + ((epoch - 1) * ONE_WEEK_SECONDS);
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
  for (const user of Object.keys(userToTotalBorrowAmountUsd)) {
    const nftCountString = await dolomite.contracts.callConstantContractFunction<string>(
      veDolo.methods.balanceOf(user),
      { blockNumber: endBlockNumber },
    );

    userToTotalVeDoloBalance[user] = INTEGERS.ZERO;
    const nftCount = Number.parseInt(nftCountString, 10);
    if (nftCount > 0) {
      const nftIdCalls: { target: string, callData: string }[] = [];
      for (let i = 0; i < nftCount; i += 1) {
        nftIdCalls.push({
          target: veDolo.options.address,
          callData: veDolo.methods.tokenOfOwnerByIndex(user, i).encodeABI(),
        });
      }
      const { results: nftIdResults } = await dolomite.multiCall.aggregate(
        nftIdCalls,
        { blockNumber: endBlockNumber },
      );

      const nftIds = nftIdResults.map(nftIdResult => {
        const nftId = dolomite.web3.eth.abi.decodeParameter('uint256', nftIdResult);
        return nftId.toString();
      });
      const balanceCalls: { target: string, callData: string }[] = [];
      for (let i = 0; i < nftIds.length; i += 1) {
        balanceCalls.push({
          target: veDolo.options.address,
          callData: veDolo.methods.balanceOfNFT(nftIds[i]).encodeABI(),
        });
      }

      const { results: balanceResults } = await dolomite.multiCall.aggregate(
        balanceCalls,
        { blockNumber: endBlockNumber },
      );
      for (const result of balanceResults) {
        const balance = dolomite.web3.eth.abi.decodeParameter('uint256', result);
        userToTotalVeDoloBalance[user] = userToTotalVeDoloBalance[user].plus(balance.toString());
      }
    }

    totalBorrowInterestUsd = totalBorrowInterestUsd.plus(userToTotalBorrowAmountUsd[user]);
  }

  const doloPrice = await dolomite.getters.getMarketPrice(DOLO_MARKET_ID, { blockNumber: endBlockNumber });

  const borrowAmountOutputFile: TotalBorrowFeesOutputFile = {
    users: Object.keys(userToTotalBorrowAmountUsd).reduce((acc, user) => {
      acc[user] = {
        totalBorrowInterestUsd: userToTotalBorrowAmountUsd[user].times(ONE_ETH_WEI).integerValue().toFixed(0),
        totalVeDoloUsd: userToTotalVeDoloBalance[user].times(doloPrice).div(ONE_ETH_WEI).integerValue().toFixed(0),
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
