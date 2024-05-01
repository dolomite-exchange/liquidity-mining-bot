import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import BlockStore from '../src/lib/block-store';
import { ONE_ETH_WEI } from '../src/lib/constants';
import { isScript } from '../src/lib/env';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import TokenAbi from './abis/isolation-mode-factory.json';
import {
  EpochMetadata,
  getMineralConfigFileNameWithPath,
  getMineralFinalizedFileNameWithPath,
  getMineralMetadataFileNameWithPath,
  MineralConfigFile,
  MineralOutputFile,
  writeMineralConfigToGitHub,
} from './lib/config-helper';
import {
  getAccountBalancesByMarket,
  getAmmLiquidityPositionAndEvents,
  getArbVestingLiquidityPositionAndEvents,
  getBalanceChangingEvents,
} from './lib/event-parser';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import {
  ARB_VESTER_PROXY,
  BLACKLIST_ADDRESSES,
  calculateFinalPoints,
  calculateMerkleRootAndProofs,
  calculateVirtualLiquidityPoints,
  ETH_USDC_POOL,
  InterestOperation,
  LiquidityPositionsAndEvents,
  processEventsUntilEndTimestamp,
} from './lib/rewards';

/* eslint-enable */

interface UserMineralAllocation {
  /**
   * The amount of minerals earned by the user
   */
  amount: Integer; // big int
  /**
   * The user's multiplier to apply. Scales from 1x to 5x, with 0.5x being gained each week
   */
  multiplier: Decimal; // decimal
}

const SECONDS_PER_WEEK = 86_400 * 7;
const WETH_MARKET_ID = '0';
const USDC_MARKET_ID = '17';
const VALID_REWARD_MULTIPLIERS_MAP = {
  [WETH_MARKET_ID]: new BigNumber(5000).div(SECONDS_PER_WEEK),
  [USDC_MARKET_ID]: new BigNumber(1).div(SECONDS_PER_WEEK),
};
const MAX_MULTIPLIER = new BigNumber('5');

export async function calculateMineralRewards(epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10)): Promise<void> {
  const networkId = await dolomite.web3.eth.net.getId();
  const liquidityMiningConfig = await readFileFromGitHub<MineralConfigFile>(
    getMineralConfigFileNameWithPath(networkId),
  );
  if (Number.isNaN(epoch) || !liquidityMiningConfig.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const blockStore = new BlockStore();
  await blockStore._update();
  const marketStore = new MarketStore(blockStore);

  const {
    startBlockNumber,
    startTimestamp,
    endBlockNumber,
    endTimestamp,
    isTimeElapsed,
  } = liquidityMiningConfig.epochs[epoch];

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
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    marketIds: Object.keys(VALID_REWARD_MULTIPLIERS_MAP),
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

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(
    apiAccounts,
    startTimestamp,
    VALID_REWARD_MULTIPLIERS_MAP,
  );

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);

  processEventsUntilEndTimestamp(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    VALID_REWARD_MULTIPLIERS_MAP,
    endTimestamp,
    InterestOperation.ADD_POSITIVE,
  );

  const ammLiquidityBalancesAndEvents = await getAmmLiquidityPositionAndEvents(
    startBlockNumber,
    startTimestamp,
    endTimestamp,
  );

  const vestingPositionsAndEvents = await getArbVestingLiquidityPositionAndEvents(
    startBlockNumber,
    startTimestamp,
    endTimestamp,
  );

  const poolToVirtualLiquidityPositionsAndEvents: Record<string, LiquidityPositionsAndEvents> = {
    [ETH_USDC_POOL]: ammLiquidityBalancesAndEvents,
    [ARB_VESTER_PROXY]: vestingPositionsAndEvents,
  };

  const poolToTotalSubLiquidityPoints = calculateVirtualLiquidityPoints(
    poolToVirtualLiquidityPositionsAndEvents,
    startTimestamp,
    endTimestamp,
  );

  const { userToPointsMap, marketToPointsMap } = calculateFinalPoints(
    networkId,
    accountToDolomiteBalanceMap,
    VALID_REWARD_MULTIPLIERS_MAP,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );
  const totalMinerals = Object.keys(marketToPointsMap).reduce((acc, market) => {
    if (VALID_REWARD_MULTIPLIERS_MAP[market]) {
      acc = acc.plus(marketToPointsMap[market])
    }
    return acc;
  }, INTEGERS.ZERO);

  const userToMineralsDataMap = await calculateFinalMinerals(userToPointsMap, networkId, epoch);

  let merkleRoot: string | null;
  let userToMineralsMapForFile: any;
  if (isTimeElapsed) {
    const userToAmountMap = Object.keys(userToMineralsDataMap).reduce((memo, k) => {
      memo[k] = userToMineralsDataMap[k].amount;
      return memo;
    }, {});
    const {
      merkleRoot: calculatedMerkleRoot,
      walletAddressToLeavesMap,
    } = calculateMerkleRootAndProofs(userToAmountMap);

    merkleRoot = calculatedMerkleRoot;
    userToMineralsMapForFile = Object.keys(walletAddressToLeavesMap).reduce((memo, k) => {
      memo[k] = {
        amount: walletAddressToLeavesMap[k].amount,
        multiplier: userToMineralsDataMap[k].multiplier.toFixed(2),
        proofs: walletAddressToLeavesMap[k].proofs,
      }
      return memo;
    }, {});
  } else {
    merkleRoot = null;
    userToMineralsMapForFile = Object.keys(userToMineralsDataMap).reduce((memo, k) => {
      memo[k] = {
        amount: userToMineralsDataMap[k].amount.toFixed(),
        multiplier: userToMineralsDataMap[k].multiplier.toFixed(2),
        proofs: [],
      }
      return memo;
    }, {});
  }

  const validMarketIds = Object.keys(VALID_REWARD_MULTIPLIERS_MAP).map(m => parseInt(m, 10));
  const marketNames = await Promise.all(
    validMarketIds.map<Promise<string>>(async validMarketId => {
      const tokenAddress = await dolomite.getters.getMarketTokenAddress(new BigNumber(validMarketId));
      const token = new dolomite.web3.eth.Contract(TokenAbi, tokenAddress);
      return dolomite.contracts.callConstantContractFunction(token.methods.symbol())
    }),
  );

  // eslint-disable-next-line max-len
  const fileName = getMineralFinalizedFileNameWithPath(networkId, epoch);
  const mineralOutputFile: MineralOutputFile = {
    users: userToMineralsMapForFile,
    metadata: {
      epoch,
      merkleRoot,
      marketNames,
      startTimestamp,
      endTimestamp,
      startBlockNumber,
      endBlockNumber,
      totalAmount: totalMinerals.times(ONE_ETH_WEI).toFixed(0),
      totalUsers: Object.keys(userToMineralsDataMap).length,
      marketIds: validMarketIds,
    },
  };
  if (!isScript()) {
    await writeFileToGitHub(fileName, mineralOutputFile, false);
  } else {
    Logger.info({
      message: 'Skipping file upload due to script execution',
    });
    writeOutputFile(`minerals-${epoch}-${startTimestamp}-${endTimestamp}-output.json`, mineralOutputFile);
  }

  if (!isScript() && merkleRoot) {
    liquidityMiningConfig.epochs[epoch].isMerkleRootGenerated = true;
    await writeMineralConfigToGitHub(liquidityMiningConfig, liquidityMiningConfig.epochs[epoch]);
  }

  if (!isScript() && merkleRoot) {
    // TODO: write merkle root to chain
    // TODO: move this to another file that can be invoked via script or `MineralsMerkleUpdater` (pings every 15 seconds
    //  for an update)
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

async function calculateFinalMinerals(
  userToPointsMap: Record<string, Integer>,
  networkId: number,
  epoch: number,
): Promise<Record<string, UserMineralAllocation>> {
  if (epoch === 0) {
    return Object.keys(userToPointsMap).reduce((memo, user) => {
      memo[user] = {
        amount: userToPointsMap[user],
        multiplier: INTEGERS.ONE,
      };
      return memo;
    }, {} as Record<string, UserMineralAllocation>)
  }

  const previousMinerals = await readFileFromGitHub<MineralOutputFile>(
    getMineralFinalizedFileNameWithPath(networkId, epoch - 1),
  );
  return Object.keys(userToPointsMap).reduce((memo, user) => {
    const userCurrent = new BigNumber(userToPointsMap[user]);
    const userPrevious = new BigNumber(previousMinerals.users[user]?.minerals ?? '0');
    const userPreviousMultiplier = new BigNumber(previousMinerals.users[user]?.multiplier ?? '1');
    const userPreviousNormalized = userPrevious.dividedToIntegerBy(userPreviousMultiplier);
    let newMultiplier = INTEGERS.ONE;
    if (userCurrent.gt(userPreviousNormalized) && userPreviousNormalized.gt(INTEGERS.ZERO)) {
      newMultiplier = userPreviousMultiplier.plus(0.5);
      if (newMultiplier.gt(MAX_MULTIPLIER)) {
        newMultiplier = MAX_MULTIPLIER
      }
    }

    memo[user] = {
      amount: userCurrent.times(newMultiplier),
      multiplier: newMultiplier,
    };
    return memo;
  }, {} as Record<string, UserMineralAllocation>)
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
