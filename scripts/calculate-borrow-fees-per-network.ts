import { Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import v8 from 'v8';
import FeeRebateClaimerAbi from '../src/abi/fee-rebate-claimer.json';
import { getBlockDataByBlockNumber, getLatestBlockDataByTimestamp } from '../src/clients/blocks';
import { getAllDolomiteAccountsWithSupplyValue, getDolomiteRiskParams } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { REBATE_START_TIMESTAMP_MAP } from '../src/lib/constants';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import Pageable from '../src/lib/pageable';
import BlockStore from '../src/lib/stores/block-store';
import MarketStore from '../src/lib/stores/market-store';
import { decodeUint256ToBigNumber } from '../src/lib/utils';
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

  if (epoch >= veDoloRebateMetadata.currentEpochIndex) {
    // There's nothing to do. The week has not passed yet
    Logger.info({
      file: __filename,
      message: 'Epoch has not passed yet. Returning...',
      foundEpoch: epoch,
      serverEpoch: veDoloRebateMetadata.currentEpochIndex,
    });
    return { epoch };
  }

  const marketIdToEnabledMap = Object.keys(veDoloRebateMetadata.allChainRebateInfo[networkId].marketToRebateInfo)
    .reduce((acc, marketId) => {
      const marketInfo = veDoloRebateMetadata.allChainRebateInfo[networkId]!.marketToRebateInfo[marketId];
      if (epoch >= marketInfo.startEpoch && epoch <= (marketInfo.endEpoch ?? Number.MAX_SAFE_INTEGER)) {
        acc[marketId] = true;
      }
      return acc;
    }, {} as Record<string, boolean | undefined>);
  const marketIds = Object.keys(marketIdToEnabledMap);
  if (marketIds.length === 0) {
    // There's nothing to do. No markets are enabled
    Logger.info({
      file: __filename,
      message: 'No markets are enabled. Returning...',
      foundEpoch: epoch,
      serverEpoch: veDoloRebateMetadata.currentEpochIndex,
    });
    return { epoch };

  }

  const feeClaimer = new dolomite.web3.eth.Contract(
    FeeRebateClaimerAbi,
    ModuleDeployments.FeeRebateClaimerProxy[dolomite.networkId].address,
  );
  const timestampCalls: { target: string, callData: string }[] = [
    {
      target: feeClaimer.options.address,
      callData: feeClaimer.methods.getClaimTimestampByEpochAndMarketId(epoch, marketIds[0]).encodeABI(),
    },
  ];
  if (epoch >= 2) {
    timestampCalls.push({
      target: feeClaimer.options.address,
      callData: feeClaimer.methods.getClaimTimestampByEpochAndMarketId(epoch - 1, marketIds[0]).encodeABI(),
    });
  }

  const { results } = await dolomite.multiCall.aggregate(timestampCalls);

  const startTimestamp = epoch >= 2
    ? decodeUint256ToBigNumber(results[1]).toNumber()
    : REBATE_START_TIMESTAMP_MAP[dolomite.networkId];
  const startBlockNumber = (await getLatestBlockDataByTimestamp(startTimestamp)).blockNumber;
  const endTimestamp = decodeUint256ToBigNumber(results[0]).toNumber();
  const endBlockNumber = (await getLatestBlockDataByTimestamp(endTimestamp)).blockNumber;
  // const startTimestamp = veDoloRebateMetadata.veDoloStartTimestamp + (ONE_WEEK_SECONDS * (epoch - 1));
  // const endTimestamp = startTimestamp + ONE_WEEK_SECONDS;

  const nextBlockData = await getBlockDataByBlockNumber(endBlockNumber + 1);
  const isTimeElapsed = !!nextBlockData && nextBlockData.timestamp > endTimestamp;
  if (!isTimeElapsed) {
    Logger.info({
      file: __filename,
      message: 'Epoch has not passed yet. Returning...',
      expectedEndTimestamp: endTimestamp,
      foundBlockTimestamp: nextBlockData?.timestamp,
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

  if (hasFile && !isScript() && !shouldForceUpload()) {
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
    endMarketMap,
  );

  const walletAddressToMarketIdToFinalBorrowFeesMap: Record<string, Record<string, Integer>> = {};
  Object.keys(userToMarketIdToBorrowInterest).forEach(user => {
    Object.keys(userToMarketIdToBorrowInterest[user]).forEach(marketId => {
      if (!marketIdToEnabledMap[marketId]) {
        // Skip the disabled markets
        return;
      }

      const amount = userToMarketIdToBorrowInterest[user][marketId];
      if (!walletAddressToMarketIdToFinalBorrowFeesMap[user]) {
        walletAddressToMarketIdToFinalBorrowFeesMap[user] = {};
      }
      const previous = walletAddressToMarketIdToFinalBorrowFeesMap[user][marketId] ?? INTEGERS.ZERO;
      walletAddressToMarketIdToFinalBorrowFeesMap[user][marketId] = previous.plus(amount);
    });
  });

  const marketTotalBorrowInterest: Record<string, Integer> = {};
  const walletAddressToMarketIdToFinalAmountStringMap: Record<string, Record<string, string>> = {};
  Object.keys(walletAddressToMarketIdToFinalBorrowFeesMap).forEach(user => {
    walletAddressToMarketIdToFinalAmountStringMap[user] = {};
    Object.keys(walletAddressToMarketIdToFinalBorrowFeesMap[user]).forEach(marketId => {
      const amount = walletAddressToMarketIdToFinalBorrowFeesMap[user][marketId];
      walletAddressToMarketIdToFinalAmountStringMap[user][marketId] = amount.toFixed();
      marketTotalBorrowInterest[marketId] = (marketTotalBorrowInterest[marketId] ?? INTEGERS.ZERO).plus(amount);
    });
  });

  const borrowAmountOutputFile: BorrowFeesPerNetworkOutputFile = {
    users: walletAddressToMarketIdToFinalAmountStringMap,
    metadata: {
      epoch,
      claimStartTimestamp: startTimestamp,
      claimStartBlockNumber: startBlockNumber,
      claimEndTimestamp: endTimestamp,
      claimEndBlockNumber: endBlockNumber,
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
      message: 'Skipping uploading output file due to script execution',
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
