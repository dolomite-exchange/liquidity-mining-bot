import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { ONE_ETH_WEI } from '../src/lib/constants';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import { readVeDoloRebateMetadataFromApi } from './lib/api-helpers';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import {
  getBorrowFeeRebateFileNameWithPath,
  getBorrowInterestFinalizedFileNameWithPath,
  getTotalBorrowInterestFinalizedFileNameWithPath,
} from './lib/config-helper';
import {
  BorrowFeesPerNetworkOutputFile,
  BorrowRebatePerNetworkOutputFile,
  TotalBorrowFeesOutputFile,
} from './lib/data-types';
import { dolomite } from '../src/helpers/web3';
import { AmountAndLeaf, calculateMerkleRootAndLeafs } from './lib/utils';

export async function calculateBorrowRebatePerNetwork(
  epoch: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
) {
  const outputFileName = getBorrowFeeRebateFileNameWithPath(dolomite.networkId);

  let hasFile = false;
  try {
    const file = await readFileFromGitHub<BorrowRebatePerNetworkOutputFile>(outputFileName);
    hasFile = file.metadata.epoch === epoch;
    // eslint-disable-next-line no-empty
  } catch (e) {
  }

  if (hasFile && !shouldForceUpload()) {
    Logger.info({
      file: __filename,
      message: 'Borrow rebates have already been calculated. Returning...',
      epoch,
    });

    return false;
  }

  const borrowRebatesMetadata = await readVeDoloRebateMetadataFromApi();

  const totalBorrowFeesFile = await readFileFromGitHub(
    getTotalBorrowInterestFinalizedFileNameWithPath(epoch),
  ) as TotalBorrowFeesOutputFile;

  const startEpoch = borrowRebatesMetadata.allChainStartEpochs[dolomite.networkId];
  if (startEpoch === null || epoch < startEpoch) {
    Logger.info({
      file: __filename,
      message: 'Skipping borrow fee rebate calculation. Epoch data is null...',
    });
    return Promise.resolve();
  }

  Logger.info({
    file: __filename,
    message: 'Calculating borrow rebates...',
  });

  let borrowAmountFile: BorrowFeesPerNetworkOutputFile;
  try {
    borrowAmountFile = await readFileFromGitHub<BorrowFeesPerNetworkOutputFile>(
      getBorrowInterestFinalizedFileNameWithPath(dolomite.networkId, epoch),
    );
  } catch (e) {
    Logger.info({
      file: __filename,
      message: 'No borrow fee file can be found yet. Returning...',
    });
    return Promise.resolve();
  }

  let userToMarketToRebate: Record<string, Record<string, Integer>>;
  let marketTotalRebate: Record<string, Integer>;
  if (epoch === 1) {
    userToMarketToRebate = {};
    marketTotalRebate = {};
  } else {
    const previousFile = await readFileFromGitHub<BorrowRebatePerNetworkOutputFile>(
      getBorrowFeeRebateFileNameWithPath(dolomite.networkId),
    );

    userToMarketToRebate = Object.keys(previousFile.users).reduce((acc1, user) => {
      acc1[user] = Object.keys(previousFile.users[user]).reduce((acc2, market) => {
        acc2[market] = new BigNumber(previousFile.users[user][market].amount);
        return acc2;
      }, {} as Record<string, Integer>);
      return acc1;
    }, {} as Record<string, Record<string, Integer>>);

    marketTotalRebate = Object.keys(previousFile.metadata.marketToTotalRebate).reduce((acc, market) => {
      acc[market] = new BigNumber(previousFile.metadata.marketToTotalRebate[market]);
      return acc;
    }, {} as Record<string, Integer>);
  }

  for (const user of Object.keys(borrowAmountFile.users)) {
    for (const marketId of Object.keys(borrowAmountFile.users[user])) {
      const marketBorrowFees = new BigNumber(borrowAmountFile.users[user][marketId]);
      const rebateInfo = totalBorrowFeesFile.users[user];
      if (rebateInfo) {
        const totalBorrowFeesUsd: Decimal = new BigNumber(rebateInfo.totalBorrowInterestUsd).div(ONE_ETH_WEI);
        const totalVeDoloUsd: Decimal = new BigNumber(rebateInfo.totalVeDoloUsd).div(ONE_ETH_WEI);
        const maxRebateUsd: Decimal = totalBorrowFeesUsd.times(borrowRebatesMetadata.maximumRebatePercentage);

        let rebate: Integer;
        if (maxRebateUsd.lte(INTEGERS.ZERO)) {
          rebate = INTEGERS.ZERO;
        } else if (totalVeDoloUsd.gte(maxRebateUsd.times(borrowRebatesMetadata.veDoloHoldingFactor))) {
          rebate = marketBorrowFees.times(borrowRebatesMetadata.maximumRebatePercentage);
        } else {
          rebate = marketBorrowFees
            .times(borrowRebatesMetadata.maximumRebatePercentage)
            .times(totalVeDoloUsd)
            .dividedToIntegerBy(maxRebateUsd.times(borrowRebatesMetadata.veDoloHoldingFactor))
        }

        if (rebate.gte(INTEGERS.ONE)) {
          if (!userToMarketToRebate[user]) {
            userToMarketToRebate[user] = {};
          }
          if (!userToMarketToRebate[user][marketId]) {
            userToMarketToRebate[user][marketId] = INTEGERS.ZERO;
          }

          userToMarketToRebate[user][marketId] = rebate.plus(userToMarketToRebate[user][marketId]);
        }
      }
    }
  }

  Object.keys(userToMarketToRebate).forEach(user => {
    Object.keys(userToMarketToRebate[user]).forEach(marketId => {
      if (!marketTotalRebate[marketId]) {
        marketTotalRebate[marketId] = INTEGERS.ZERO;
      }
      marketTotalRebate[marketId] = marketTotalRebate[marketId].plus(userToMarketToRebate[user][marketId]);
    });
  });

  const walletAddressToMarketIdToLeafMap: Record<string, Record<string, AmountAndLeaf>> = {};
  const marketToMerkleRoot: Record<string, string> = {};
  for (const marketId of Object.keys(marketTotalRebate)) {
    const userToAmounts = Object.keys(userToMarketToRebate).reduce((acc, user) => {
      const rebate = userToMarketToRebate[user][marketId];
      if (rebate && rebate.gt(INTEGERS.ONE)) {
        acc[user] = userToMarketToRebate[user][marketId];
      }
      return acc;
    }, {} as Record<string, Integer>);

    const { merkleRoot, walletAddressToLeafMap } = await calculateMerkleRootAndLeafs(userToAmounts);

    marketToMerkleRoot[marketId] = merkleRoot;
    Object.keys(walletAddressToLeafMap).forEach(user => {
      if (!walletAddressToMarketIdToLeafMap[user]) {
        walletAddressToMarketIdToLeafMap[user] = {};
      }
      walletAddressToMarketIdToLeafMap[user][marketId] = walletAddressToLeafMap[user];
    });
  }

  const borrowRebatePerNetworkOutputFile: BorrowRebatePerNetworkOutputFile = {
    users: walletAddressToMarketIdToLeafMap,
    metadata: {
      epoch,
      marketToMerkleRoot,
      totalUsers: Object.keys(userToMarketToRebate).length,
      marketToTotalRebate: Object.keys(marketTotalRebate).reduce((acc, marketId) => {
        acc[marketId] = marketTotalRebate[marketId].toFixed(0);
        return acc;
      }, {}),
    },
  };

  if (!isScript() || shouldForceUpload()) {
    await writeFileToGitHub(outputFileName, borrowRebatePerNetworkOutputFile, false);
  } else {
    Logger.info({
      file: __filename,
      message: 'Skipping output file upload due to script execution',
    });
    writeOutputFile(outputFileName, borrowRebatePerNetworkOutputFile);
  }

  return { epoch };
}

if (isScript()) {
  calculateBorrowRebatePerNetwork()
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
