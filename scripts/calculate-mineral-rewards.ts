import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import BlockStore from '../src/lib/block-store';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import TokenAbi from './abis/isolation-mode-factory.json';
import './lib/env-reader';
import {
  getAccountBalancesByMarket,
  getAmmLiquidityPositionAndEvents,
  getArbVestingLiquidityPositionAndEvents,
  getBalanceChangingEvents,
} from './lib/event-parser';
import { MineralConfigFile, readFileFromGitHub, writeFileLocally } from './lib/file-helpers';
import {
  ARB_VESTER_PROXY,
  calculateFinalPoints,
  calculateLiquidityPoints, calculateMerkleRootAndProofs,
  calculateTotalRewardPoints,
  ETH_USDC_POOL,
  InterestOperation,
  LiquidityPositionsAndEvents,
} from './lib/rewards';

/* eslint-enable */

interface UserMineralAllocation {
  minerals: Integer; // big int
  multiplier: Decimal; // decimal
}

interface UserMineralAllocationForFile {
  minerals: string; // big int
  multiplier: string; // decimal
  proofs: string[];
}

interface MineralOutputFile {
  users: {
    [walletAddressLowercase: string]: UserMineralAllocationForFile
  };
  metadata: {
    merkleRoot: string;
    marketIds: number[]
    marketNames: string[]
    totalPoints: string // big int
    startBlock: number
    endBlock: number
    startTimestamp: number
    endTimestamp: number
  };
}

const SEASON_NUMBER = 0;

const SECONDS_PER_WEEK = 86_400 * 7;
const WETH_MARKET_ID = '0';
const USDC_MARKET_ID = '17';
const VALID_REWARD_MULTIPLIERS_MAP = {
  [WETH_MARKET_ID]: new BigNumber(5000).div(SECONDS_PER_WEEK),
  [USDC_MARKET_ID]: new BigNumber(1).div(SECONDS_PER_WEEK),
};
const MAX_MULTIPLIER = new BigNumber('5');

async function start(epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10)) {
  const liquidityMiningConfig = await readFileFromGitHub<MineralConfigFile>('scripts/config/mineral-season-0.json');
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
    isFinalized,
  } = liquidityMiningConfig.epochs[epoch];

  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'DolomiteMargin data',
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

  const totalPointsToMarketMap = calculateTotalRewardPoints(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    VALID_REWARD_MULTIPLIERS_MAP,
    endTimestamp,
    InterestOperation.ADD_POSITIVE,
  );
  const totalPoints = Object.keys(totalPointsToMarketMap).reduce((acc, market) => {
    if (VALID_REWARD_MULTIPLIERS_MAP[market]) {
      acc = acc.plus(totalPointsToMarketMap[market])
    }
    return acc;
  }, INTEGERS.ZERO);

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

  const poolToTotalSubLiquidityPoints = calculateLiquidityPoints(
    poolToVirtualLiquidityPositionsAndEvents,
    startTimestamp,
    endTimestamp,
  );

  const userToPointsMap = calculateFinalPoints(
    accountToDolomiteBalanceMap,
    VALID_REWARD_MULTIPLIERS_MAP,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );

  const userToMineralsDataMap = await calculateFinalMinerals(userToPointsMap, epoch);
  const userToAmountMap = Object.keys(userToMineralsDataMap).reduce((memo, k) => {
    memo[k] = userToMineralsDataMap[k].minerals;
    return memo;
  }, {})
  const { merkleRoot, walletAddressToLeavesMap } = calculateMerkleRootAndProofs(userToAmountMap);
  const userToMineralsMapForFile = Object.keys(walletAddressToLeavesMap).reduce((memo, k) => {
    memo[k] = {
      minerals: walletAddressToLeavesMap[k].amount,
      multiplier: userToMineralsDataMap[k].multiplier.toFixed(2),
      proofs: walletAddressToLeavesMap[k].proofs,
    }
    return memo;
  }, {});

  const validMarketIds = Object.keys(VALID_REWARD_MULTIPLIERS_MAP).map(m => parseInt(m));
  const marketNames = await Promise.all(
    validMarketIds.map<Promise<string>>(async validMarketId => {
      const tokenAddress = await dolomite.getters.getMarketTokenAddress(new BigNumber(validMarketId));
      const token = new dolomite.web3.eth.Contract(TokenAbi, tokenAddress);
      return dolomite.contracts.callConstantContractFunction(token.methods.name())
    }),
  );

  // eslint-disable-next-line max-len
  const fileName = getFileNameByEpoch(epoch);
  const mineralOutputFile: MineralOutputFile = {
    users: userToMineralsMapForFile,
    metadata: {
      merkleRoot,
      marketNames,
      totalPoints: totalPoints.toFixed(),
      marketIds: validMarketIds,
      startBlock: startBlockNumber,
      endBlock: endBlockNumber,
      startTimestamp: startTimestamp,
      endTimestamp: endTimestamp,
    },
  };
  // writeLargeFileToGitHub(fileName, dataToWrite);
  writeFileLocally(`${__dirname}/${fileName}`, JSON.stringify(mineralOutputFile));

  if (isFinalized) {
    // TODO: write merkle root to chain
  }

  return true;
}

async function calculateFinalMinerals(
  userToPointsMap: Record<string, string>,
  epoch: number,
): Promise<Record<string, UserMineralAllocation>> {
  if (epoch === 0) {
    return Object.keys(userToPointsMap).reduce((memo, user) => {
      memo[user] = {
        minerals: new BigNumber(userToPointsMap[user]),
        multiplier: INTEGERS.ONE,
      };
      return memo;
    }, {} as Record<string, UserMineralAllocation>)
  }

  const previousMinerals = await readFileFromGitHub<MineralOutputFile>(getFileNameByEpoch(epoch - 1));
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
      minerals: userCurrent.times(newMultiplier),
      multiplier: newMultiplier,
    };
    return memo;
  }, {} as Record<string, UserMineralAllocation>)
}

function getFileNameByEpoch(epoch: number): string {
  return `finalized/minerals/minerals-season-${SEASON_NUMBER}-epoch-${epoch}-output.json`
}

if (process.env.MINERALS_ENABLED !== 'true') {
  start()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while starting:', error);
      process.exit(1);
    });
}
