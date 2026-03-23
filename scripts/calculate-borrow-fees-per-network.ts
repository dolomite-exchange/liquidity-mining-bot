import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { getBlockDataByBlockNumber, getLatestBlockDataByTimestamp } from '../src/clients/blocks';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { ONE_WEEK_SECONDS } from '../src/lib/constants';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import BlockStore from '../src/lib/stores/block-store';
import MarketStore from '../src/lib/stores/market-store';
import { readVeDoloRebateMetadataFromApi } from './lib/api-helpers';
import { getBorrowInterestFinalizedFileNameWithPath } from './lib/config-helper';
import { BorrowFeesPerNetworkOutputFile } from './lib/data-types';
import { getAccountBalancesByMarket, getBalanceChangingEvents } from './lib/event-parser';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import { calculateBorrowInterest, InterestOperation, processEventsUntilEndTimestamp } from './lib/rewards';

const REWARD_MULTIPLIERS_MAP = {};

export interface BorrowAmountsPerNetworkCalculation {
  epoch: number;
}

export async function calculateBorrowFeesPerNetwork(
  epoch: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
): Promise<BorrowAmountsPerNetworkCalculation> {
  const { networkId } = dolomite;

  if (Number.isNaN(epoch)) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const veDoloRebateMetadata = await readVeDoloRebateMetadataFromApi();

  const blockStore = new BlockStore();
  await blockStore._update();

  const marketStore = new MarketStore(blockStore, false);

  if (epoch === veDoloRebateMetadata.currentEpochIndex) {
    // There's nothing to do. The week has not passed yet
    Logger.info({
      file: __filename,
      message: 'Epoch has not passed yet. Returning...',
    });
    return { epoch };
  }

  const startTimestamp = veDoloRebateMetadata.currentEpochStartTimestamp;
  const startBlockNumber = (await getLatestBlockDataByTimestamp(startTimestamp)).blockNumber;
  const endTimestamp = startTimestamp + ONE_WEEK_SECONDS;
  const endBlockNumber = (await getLatestBlockDataByTimestamp(endTimestamp)).blockNumber;

  const nextBlockData = await getBlockDataByBlockNumber(endBlockNumber + 1);
  const isTimeElapsed = !!nextBlockData && nextBlockData.timestamp > endTimestamp;
  if (!isTimeElapsed) {
    Logger.info({
      file: __filename,
      message: 'Epoch has not passed yet. Returning...',
    });
    return { epoch };
  }

  const outputFileName = getBorrowInterestFinalizedFileNameWithPath(networkId, epoch);
  let hasFile = false;
  try {
    await readFileFromGitHub(outputFileName)
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

    return { epoch };
  }

  const { riskParams } = await getDolomiteRiskParams(startBlockNumber);

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (riskParams.dolomiteMargin !== libraryDolomiteMargin) {
    const message = `Invalid dolomite margin address found!\n
    { network: ${riskParams.dolomiteMargin} library: ${libraryDolomiteMargin} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  } else if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    file: __filename,
    message: 'DolomiteMargin data for borrow amount calculation',
    blockStart: startBlockNumber,
    blockStartTimestamp: startTimestamp,
    blockEnd: endBlockNumber,
    blockEndTimestamp: endTimestamp,
    dolomiteMargin: libraryDolomiteMargin,
    epochNumber: epoch,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update(startBlockNumber);
  const startMarketMap = marketStore.getMarketMap();
  const startMarketIndexMap = await marketStore.getMarketIndexMap(startMarketMap, { blockNumber: startBlockNumber });

  await marketStore._update(endBlockNumber);
  const endMarketMap = marketStore.getMarketMap();
  const endMarketIndexMap = await marketStore.getMarketIndexMap(endMarketMap, { blockNumber: endBlockNumber });

  const apiAccounts = await Pageable.getPageableValues(async (lastId) => {
    const result = await getAllDolomiteAccountsWithSupplyValue(startMarketIndexMap, startBlockNumber, lastId);
    return result.accounts;
  });

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(apiAccounts, startTimestamp, REWARD_MULTIPLIERS_MAP);

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);

  processEventsUntilEndTimestamp(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    {}, // no points per second needed for ONLY_NEGATIVE interest operation
    endTimestamp,
    InterestOperation.ONLY_NEGATIVE,
  );

  const userToMarketIdToBorrowInterest = calculateBorrowInterest(
    networkId,
    accountToDolomiteBalanceMap,
  );

  const walletAddressToMarketIdToFinalAmountMap: Record<string, Record<string, Integer>> = {};
  if (epoch > 1) {
    const previousOutputFileName = getBorrowInterestFinalizedFileNameWithPath(networkId, epoch - 1);
    const previousBorrowAmountOutputFile = await readFileFromGitHub<BorrowFeesPerNetworkOutputFile>(
      previousOutputFileName,
    );
    Object.keys(previousBorrowAmountOutputFile.users).forEach(user => {
      walletAddressToMarketIdToFinalAmountMap[user] = {};
      Object.keys(previousBorrowAmountOutputFile.users[user]).forEach(marketId => {
        walletAddressToMarketIdToFinalAmountMap[user][marketId] = new BigNumber(
          previousBorrowAmountOutputFile.users[user][marketId],
        );
      });
    });
  }

  const marketTotalBorrowInterest: Record<string, Integer> = {};
  Object.keys(userToMarketIdToBorrowInterest).forEach(user => {
    Object.keys(userToMarketIdToBorrowInterest[user]).forEach(marketId => {
      const amount = userToMarketIdToBorrowInterest[user][marketId];
      if (!walletAddressToMarketIdToFinalAmountMap[user]) {
        walletAddressToMarketIdToFinalAmountMap[user] = {};
      }
      const previous = walletAddressToMarketIdToFinalAmountMap[user][marketId] ?? INTEGERS.ZERO;
      walletAddressToMarketIdToFinalAmountMap[user][marketId] = previous.plus(amount);
    });
  });

  const walletAddressToMarketIdToFinalAmountStringMap: Record<string, Record<string, string>> = {};
  Object.keys(walletAddressToMarketIdToFinalAmountMap).forEach(user => {
    walletAddressToMarketIdToFinalAmountStringMap[user] = {};
    Object.keys(walletAddressToMarketIdToFinalAmountMap[user]).forEach(marketId => {
      const amount = walletAddressToMarketIdToFinalAmountMap[user][marketId];
      walletAddressToMarketIdToFinalAmountStringMap[user][marketId] = amount.toFixed();
      marketTotalBorrowInterest[marketId] = (marketTotalBorrowInterest[marketId] ?? INTEGERS.ZERO).plus(amount);
    });
  });

  const borrowAmountOutputFile: BorrowFeesPerNetworkOutputFile = {
    users: walletAddressToMarketIdToFinalAmountStringMap,
    metadata: {
      epoch,
      totalUsers: Object.keys(walletAddressToMarketIdToFinalAmountStringMap).length,
      marketTotalBorrowInterest: Object.keys(marketTotalBorrowInterest).reduce((acc, market) => {
        acc[market] = marketTotalBorrowInterest[market].toFixed();
        return acc;
      }, {} as Record<string, string>),
      marketPrices: Object.values(marketStore.getMarketMap()).reduce((acc, market) => {
        if (market.oraclePrice) {
          acc[market.marketId] = market.oraclePrice.toFixed();
        }
        return acc;
      }, {} as Record<string, string>),
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

  return { epoch };
}

if (isScript()) {
  calculateBorrowFeesPerNetwork()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
