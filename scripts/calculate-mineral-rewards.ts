import { BigNumber, Decimal, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { getAllDolomiteAccountsWithSupplyValue } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import BlockStore from '../src/lib/stores/block-store';
import { ChainId } from '../src/lib/chain-id';
import { isScript, shouldForceUpload } from '../src/lib/env';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/stores/market-store';
import Pageable from '../src/lib/pageable';
import TokenAbi from './abis/isolation-mode-factory.json';
import {
  getMineralConfigFileNameWithPath,
  getMineralFinalizedFileNameWithPath,
  getMineralMetadataFileNameWithPath,
  MINERAL_SEASON,
  writeMineralConfigToGitHub,
} from './lib/config-helper';
import { EpochMetadata, MineralConfigFile, MineralOutputFile, UserMineralAllocationForFile } from './lib/data-types';
import {
  getAccountBalancesByMarket,
  getBalanceChangingEvents,
  getPoolAddressToVirtualLiquidityPositionsAndEvents,
} from './lib/event-parser';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import { setupRemapping } from './lib/remapper';
import {
  BLACKLIST_ADDRESSES,
  calculateFinalPoints,
  calculateVirtualLiquidityPoints,
  InterestOperation,
  processEventsUntilEndTimestamp,
} from './lib/rewards';
import { calculateMerkleRootAndProofs } from './lib/utils';

/* eslint-enable */

export interface MineralEpochMetadata extends EpochMetadata {
  deltas: number[]
  pendleMetadata: {
    startEpochNumber: number
    maxEpochNumber: number
  }
}

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
const MAX_MULTIPLIER = new BigNumber('5');
const HARVEST_MULTIPLIER = new BigNumber(3);
const BOOSTED_POOLS: Record<number, Record<string, BigNumber | undefined>> = {
  [ChainId.ArbitrumOne]: {
    ['0xA95E010aF63196747F459176A1B85d250E8211b4'.toLowerCase()]: HARVEST_MULTIPLIER, // Harvest Finance DAI
    ['0xD174dd89af9F58804B47A67435317bc31f971cee'.toLowerCase()]: HARVEST_MULTIPLIER, // Harvest Finance USDC
    ['0x257b80afB7143D8877D16Aae58ffCa4C0b1D3F13'.toLowerCase()]: HARVEST_MULTIPLIER, // Harvest Finance USDT
    ['0xFDF482245b68CfEB89b3873Af9f0Bb210d815A7C'.toLowerCase()]: HARVEST_MULTIPLIER, // Harvest Finance WBTC
    ['0x6C7d2382Ec65582c839BC4f55B55922Be69f8764'.toLowerCase()]: HARVEST_MULTIPLIER, // Harvest Finance USDC.e
    ['0x2E53f490FB438c9d2d0d7D7Ab17153A2f4a20870'.toLowerCase()]: HARVEST_MULTIPLIER, // Harvest Finance GMX
    ['0x905Fea083FbbcaCf1cF1c7Bb15f6504A458cCACb'.toLowerCase()]: HARVEST_MULTIPLIER, // Harvest Finance ETH
  },
};

export async function calculateMineralRewards(epoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10)): Promise<void> {
  const networkId = dolomite.networkId;
  const liquidityMiningConfig = await readFileFromGitHub<MineralConfigFile>(
    getMineralConfigFileNameWithPath(networkId),
  );
  if (Number.isNaN(epoch) || !liquidityMiningConfig.epochs[epoch]) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const blockStore = new BlockStore();
  await blockStore._update();
  const marketStore = new MarketStore(blockStore, true);

  const {
    startBlockNumber,
    startTimestamp,
    endBlockNumber,
    endTimestamp,
    isTimeElapsed,
    isMerkleRootGenerated,
    marketIdToRewardMap,
    boostedMultiplier,
  } = liquidityMiningConfig.epochs[epoch];

  if (isTimeElapsed && isMerkleRootGenerated && !isScript()) {
    // If this epoch is finalized, and we're not in a script, return.
    Logger.info({
      at: 'calculateMineralRewards',
      message: `Epoch ${epoch} has passed and merkle root was generated, skipping...`,
    });
    return Promise.resolve();
  }

  if (!Object.keys(marketIdToRewardMap).every(m => !Number.isNaN(parseInt(m, 10)))) {
    return Promise.reject(new Error('Invalid market ID in map'));
  } else if (!Object.values(marketIdToRewardMap).every(m => !new BigNumber(m).isNaN())) {
    return Promise.reject(new Error('Reward amounts are invalid'));
  } else if (!Object.values(marketIdToRewardMap).every(m => new BigNumber(m).lt(1_000_000))) {
    return Promise.reject(new Error('Reward amounts are too large. Is this a bug?'));
  }

  const validRewardMultipliersMap = Object.keys(marketIdToRewardMap).reduce((memo, marketId) => {
    memo[marketId] = new BigNumber(marketIdToRewardMap[marketId]).div(SECONDS_PER_WEEK)
    return memo;
  }, {} as Record<string, Decimal>)

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
    marketIds: Object.keys(marketIdToRewardMap),
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

  await setupRemapping(networkId, endBlockNumber);

  const accountToDolomiteBalanceMap = getAccountBalancesByMarket(
    apiAccounts,
    startTimestamp,
    validRewardMultipliersMap,
  );

  const accountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);

  processEventsUntilEndTimestamp(
    accountToDolomiteBalanceMap,
    accountToAssetToEventsMap,
    endMarketIndexMap,
    validRewardMultipliersMap,
    endTimestamp,
    InterestOperation.ADD_POSITIVE,
  );

  const poolToVirtualLiquidityPositionsAndEvents = await getPoolAddressToVirtualLiquidityPositionsAndEvents(
    networkId,
    startBlockNumber,
    startTimestamp,
    endTimestamp,
    true,
  );

  const poolToTotalSubLiquidityPoints = calculateVirtualLiquidityPoints(
    poolToVirtualLiquidityPositionsAndEvents,
    startTimestamp,
    endTimestamp,
  );

  const { userToPointsMap, marketToPointsMap }: {
    userToPointsMap: Record<string, Integer>;
    userToMarketToPointsMap: Record<string, Record<string, Integer>>;
    marketToPointsMap: Record<string, Integer>;
  } = calculateFinalPoints(
    networkId,
    accountToDolomiteBalanceMap,
    validRewardMultipliersMap,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );
  const totalMinerals: Integer = Object.keys(marketToPointsMap).reduce((acc, market) => {
    if (validRewardMultipliersMap[market]) {
      acc = acc.plus(marketToPointsMap[market])
    }
    return acc;
  }, INTEGERS.ZERO);

  const userToMineralsDataMap = await calculateFinalMinerals(
    userToPointsMap,
    networkId,
    epoch,
    isTimeElapsed,
    boostedMultiplier, // The boosted multiplier is only used if `isTimeElapsed` is set to `true`
  );

  let merkleRoot: string | null;
  let userToMineralsMapForFile: Record<string, UserMineralAllocationForFile>;
  if (isTimeElapsed) {
    const userToAmountMap = Object.keys(userToMineralsDataMap).reduce((memo, k) => {
      memo[k] = userToMineralsDataMap[k].amount;
      return memo;
    }, {});
    const {
      merkleRoot: calculatedMerkleRoot,
      walletAddressToProofsMap,
    } = await calculateMerkleRootAndProofs(userToAmountMap);

    merkleRoot = calculatedMerkleRoot;
    userToMineralsMapForFile = Object.keys(walletAddressToProofsMap).reduce((memo, k) => {
      memo[k] = {
        amount: walletAddressToProofsMap[k].amount,
        multiplier: userToMineralsDataMap[k].multiplier.toFixed(2),
        proofs: walletAddressToProofsMap[k].proofs,
      }
      return memo;
    }, {} as Record<string, UserMineralAllocationForFile>);
  } else {
    merkleRoot = null;
    userToMineralsMapForFile = Object.keys(userToMineralsDataMap).reduce((memo, k) => {
      memo[k] = {
        amount: userToMineralsDataMap[k].amount.toFixed(),
        multiplier: userToMineralsDataMap[k].multiplier.toFixed(2),
        proofs: [],
      }
      return memo;
    }, {} as Record<string, UserMineralAllocationForFile>);
  }

  const validMarketIds = Object.keys(validRewardMultipliersMap).map(m => parseInt(m, 10));
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
      boostedMultiplier,
      totalAmount: totalMinerals.toFixed(0),
      totalUsers: Object.keys(userToMineralsDataMap).length,
      marketIds: validMarketIds,
    },
  };
  if (!isScript() || shouldForceUpload()) {
    await writeFileToGitHub(fileName, mineralOutputFile, false);
  } else {
    Logger.info({
      message: 'Skipping file upload due to script execution',
    });
    writeOutputFile(`mineral-${networkId}-season-${MINERAL_SEASON}-epoch-${epoch}-output.json`, mineralOutputFile);
  }

  if ((!isScript() || shouldForceUpload()) && merkleRoot) {
    liquidityMiningConfig.epochs[epoch].isMerkleRootGenerated = true;
    await writeMineralConfigToGitHub(liquidityMiningConfig, liquidityMiningConfig.epochs[epoch]);
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
  networkId: ChainId,
  epoch: number,
  isTimeElapsed: boolean,
  boostedMultiplier: string | undefined | null,
): Promise<Record<string, UserMineralAllocation>> {
  if (epoch === 0) {
    return Object.keys(userToPointsMap).reduce((memo, user) => {
      memo[user] = {
        amount: userToPointsMap[user].times(boostedMultiplier ?? '1'),
        multiplier: INTEGERS.ONE,
      };
      return memo;
    }, {} as Record<string, UserMineralAllocation>)
  }

  const previousMinerals = await readFileFromGitHub<MineralOutputFile>(
    getMineralFinalizedFileNameWithPath(networkId, epoch - 1),
  );
  const previousBoost = previousMinerals.metadata.boostedMultiplier ?? '1';
  return Object.keys(userToPointsMap).reduce((memo, user) => {
    const userCurrent = userToPointsMap[user];
    const userPrevious = new BigNumber(previousMinerals.users[user]?.amount ?? '0');
    const userPreviousMultiplierPreBoost = new BigNumber(previousMinerals.users[user]?.multiplier ?? '1')
      .times(previousBoost);
    const userPreviousMultiplierWithBoost = userPreviousMultiplierPreBoost.times(previousBoost);
    const userPreviousNormalized = userPrevious.dividedToIntegerBy(userPreviousMultiplierWithBoost);
    const userPreviousNormalizedWithSlippage = userPreviousNormalized.times(99).dividedToIntegerBy(100);
    let newMultiplier = INTEGERS.ONE;
    if (isTimeElapsed && networkId === ChainId.ArbitrumOne) {
      newMultiplier = MAX_MULTIPLIER
    } else if (isTimeElapsed && BOOSTED_POOLS[networkId][user]) {
      newMultiplier = BOOSTED_POOLS[networkId][user]!;
    } else if (
      isTimeElapsed
      && userCurrent.gt(userPreviousNormalizedWithSlippage)
      && userPreviousNormalizedWithSlippage.gt(INTEGERS.ZERO)
    ) {
      newMultiplier = userPreviousMultiplierPreBoost.plus(0.5);
      if (newMultiplier.gt(MAX_MULTIPLIER)) {
        newMultiplier = MAX_MULTIPLIER
      }
    }
    const multiplierWithBoost = newMultiplier.times(isTimeElapsed && boostedMultiplier ? boostedMultiplier : '1');

    memo[user] = {
      amount: userCurrent.times(multiplierWithBoost),
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
