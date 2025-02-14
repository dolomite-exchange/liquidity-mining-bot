import { BigNumber, Decimal, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { parseEther } from 'ethers/lib/utils';
import fs from 'fs';
import v8 from 'v8';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { isScript } from '../src/lib/env';
import Logger from '../src/lib/logger';
import BlockStore from '../src/lib/stores/block-store';
import MarketStore from '../src/lib/stores/market-store';
import '../src/lib/env'
import { setupRemapping } from './lib/remapper';
import {
  AccountToSubAccountToMarketToBalanceChangeMap,
  addToBlacklist,
  BalanceChangeEvent,
  calculateFinalPoints,
  calculateVirtualLiquidityPoints, FinalPointsStruct,
  InterestOperation,
  processEventsWithDifferingPointsBasedOnTimestampUntilEndTimestamp,
} from './lib/rewards';

/* eslint-enable */

const OUTPUT_FILE_NAME = `${process.cwd()}/scripts/output/regular-airdrop-data-${dolomite.networkId}-borrows.json`;
const TOTAL_DOLO_TOKENS = new BigNumber(parseEther(`${90_000_000}`).toString());

interface OutputFile {
  users: {
    [walletAddressLowercase: string]: string // big int
  };
  metadata: {
    totalUserPoints: string // big int
    startBlock: number
    endBlock: number
    startTimestamp: number
    endTimestamp: number
    totalUsers: number
  };
}

interface Metadata {
  startBlockNumber: number;
  startTimestamp: number;
  endBlockNumber: number;
  endTimestamp: number;
}

type TimestampToMarketToPriceMap = Record<string, Record<string, Decimal>>;

const CHAIN_ID_TO_METADATA_MAP: Record<ChainId, Metadata | undefined> = {
  [ChainId.ArbitrumOne]: {
    startBlockNumber: 28220369,
    startTimestamp: 1664843669,
    endBlockNumber: 292404278,
    endTimestamp: 1736121600,
  },
  [ChainId.Base]: undefined,
  [ChainId.Berachain]: undefined,
  [ChainId.Mantle]: {
    startBlockNumber: 63091469,
    startTimestamp: 1714327650,
    endBlockNumber: 73995644,
    endTimestamp: 1736121600,
  },
  [ChainId.PolygonZkEvm]: {
    startBlockNumber: 9597567,
    startTimestamp: 1706779116,
    endBlockNumber: 18931071,
    endTimestamp: 1736121598,
  },
  [ChainId.XLayer]: {
    startBlockNumber: 832938,
    startTimestamp: 1714329576,
    endBlockNumber: 8051139,
    endTimestamp: 1736121598,
  },
};

const CHAIN_TO_MARKET_TO_EXTRA_MULTIPLIER_MAP: Record<ChainId, Record<string, Decimal>> = {
  [ChainId.ArbitrumOne]: {
    [0]: new BigNumber(1),
  },
  [ChainId.Base]: {},
  [ChainId.Berachain]: {},
  [ChainId.Mantle]: {},
  [ChainId.PolygonZkEvm]: {},
  [ChainId.XLayer]: {},
}

const FOLDER_NAME = `${__dirname}/output`;

export async function calculateRegularAirdrop() {
  const { networkId } = dolomite;

  const metadata = CHAIN_ID_TO_METADATA_MAP[networkId as ChainId]!;
  const ignorePendle = networkId !== ChainId.ArbitrumOne;

  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore, true);

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'DolomiteMargin data',
    blockRewardStart: metadata.startBlockNumber,
    blockRewardStartTimestamp: metadata.startTimestamp,
    blockRewardEnd: metadata.endBlockNumber,
    blockRewardEndTimestamp: metadata.endTimestamp,
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    ignorePendle,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update(metadata.startBlockNumber);

  await marketStore._update(metadata.endBlockNumber);
  const endMarketMap = marketStore.getMarketMap();
  const endMarketIndexMap = await marketStore.getMarketIndexMap(endMarketMap, { blockNumber: metadata.endBlockNumber });
  const marketIdToValidMarketsMap = Object.keys(endMarketMap).reduce((acc, marketId) => {
    acc[marketId] = INTEGERS.ONE;
    return acc;
  }, {});

  const goArbVesterProxy = ModuleDeployments.GravitaExternalVesterProxy[networkId];
  if (goArbVesterProxy) {
    addToBlacklist(goArbVesterProxy.address);
  }

  await setupRemapping(networkId, metadata.endBlockNumber);

  const supplyAccountToDolomiteBalanceMap = {};
  const allSupplyPriceMap = getAllPricesFromFile(networkId, INTEGERS.ONE);
  processEventsWithDifferingPointsBasedOnTimestampUntilEndTimestamp(
    supplyAccountToDolomiteBalanceMap,
    getUserToAccountNumberToAssetToEventsMapFromFile(networkId),
    endMarketIndexMap,
    allSupplyPriceMap,
    metadata.endTimestamp,
    InterestOperation.ADD_POSITIVE,
  );

  const borrowAccountToDolomiteBalanceMap = {};
  const allBorrowPriceMap = getAllPricesFromFile(networkId, INTEGERS.ONE);
  processEventsWithDifferingPointsBasedOnTimestampUntilEndTimestamp(
    borrowAccountToDolomiteBalanceMap,
    getUserToAccountNumberToAssetToEventsMapFromFile(networkId),
    endMarketIndexMap,
    allBorrowPriceMap,
    metadata.endTimestamp,
    InterestOperation.ADD_NEGATIVE,
  );

  // const poolToVirtualLiquidityPositionsAndEvents = await getPoolAddressToVirtualLiquidityPositionsAndEvents(
  //   networkId,
  //   metadata.startBlockNumber,
  //   metadata.startTimestamp,
  //   metadata.endTimestamp,
  //   ignorePendle,
  // );
  const poolToVirtualLiquidityPositionsAndEvents = {};

  const poolToTotalSubLiquidityPoints = calculateVirtualLiquidityPoints(
    poolToVirtualLiquidityPositionsAndEvents,
    metadata.startTimestamp,
    metadata.endTimestamp,
  );

  const supplyFinalPoints = calculateFinalPoints(
    networkId,
    supplyAccountToDolomiteBalanceMap,
    marketIdToValidMarketsMap,
    poolToVirtualLiquidityPositionsAndEvents,
    poolToTotalSubLiquidityPoints,
  );
  typeof supplyFinalPoints;
  const borrowFinalPoints = calculateFinalPoints(
    networkId,
    borrowAccountToDolomiteBalanceMap,
    marketIdToValidMarketsMap,
    {},
    {},
  );

  const allFinalPoints = [borrowFinalPoints];
  const totalUserPoints = allFinalPoints.reduce((acc, struct) => acc.plus(struct.totalUserPoints), INTEGERS.ZERO);
  const dataToWrite: OutputFile = {
    users: {},
    metadata: {
      totalUserPoints: totalUserPoints.div(parseEther('1').toString()).toFixed(0),
      startBlock: metadata.startBlockNumber,
      endBlock: metadata.endBlockNumber,
      startTimestamp: metadata.startTimestamp,
      endTimestamp: metadata.endTimestamp,
      totalUsers: 0,
    },
  };

  dataToWrite.users = getFinalDoloAllocations(allFinalPoints);
  dataToWrite.metadata.totalUsers = Object.keys(dataToWrite.users).length;

  writeOutputFile(dataToWrite);

  return true;
}

function getAllPricesFromFile(networkId: number, extraMultiplier: Decimal): TimestampToMarketToPriceMap {
  const allPriceMapRaw = JSON.parse(fs.readFileSync(
    `${process.cwd()}/scripts/output/data/all-prices-${networkId}.json`,
    'utf8',
  ))['data'];

  return Object.keys(allPriceMapRaw).reduce((acc, key) => {
    acc[key] = {};
    Object.keys(allPriceMapRaw[key]).forEach(marketId => {
      const inlineMultiplier = CHAIN_TO_MARKET_TO_EXTRA_MULTIPLIER_MAP[networkId][marketId] ?? INTEGERS.ONE;
      acc[key][marketId] = new BigNumber(allPriceMapRaw[key][marketId]).times(inlineMultiplier).times(extraMultiplier);
    });
    return acc;
  }, {} as TimestampToMarketToPriceMap);
}

function getUserToAccountNumberToAssetToEventsMapFromFile(networkId: number): AccountToSubAccountToMarketToBalanceChangeMap {
  const userToAccountNumberToAssetToEventsMapRaw = JSON.parse(fs.readFileSync(
    `${process.cwd()}/scripts/output/data/all-events-${networkId}.json`,
    'utf8',
  ))['data'];

  return Object.keys(userToAccountNumberToAssetToEventsMapRaw)
    .reduce((acc1, user) => {
      acc1[user] = {};
      Object.keys(userToAccountNumberToAssetToEventsMapRaw[user]).forEach(accountNumber => {
        acc1[user]![accountNumber] = {};
        Object.keys(userToAccountNumberToAssetToEventsMapRaw[user][accountNumber]).forEach(marketId => {
          const rawEvents = userToAccountNumberToAssetToEventsMapRaw[user][accountNumber][marketId];
          acc1[user]![accountNumber]![marketId] = rawEvents.map((rawEvent: any) => ({
            amountDeltaPar: new BigNumber(rawEvent.amountDeltaPar),
            interestIndex: {
              marketId: rawEvent.marketId,
              supply: new BigNumber(rawEvent.interestIndex.supply),
              borrow: new BigNumber(rawEvent.interestIndex.borrow),
            },
            timestamp: rawEvent.timestamp,
            serialId: rawEvent.serialId,
            effectiveUser: rawEvent.effectiveUser,
            marketId: rawEvent.marketId,
          } as BalanceChangeEvent));
        });
      });
      return acc1;
    }, {} as AccountToSubAccountToMarketToBalanceChangeMap);
}

function getFinalDoloAllocations(finalPointsStructs: FinalPointsStruct[]) {
  let totalUserPoints = INTEGERS.ZERO;
  // Add supply data
  const allUsersMap = {};

  finalPointsStructs.forEach(struct => {
    Object.keys(struct.userToPointsMap).forEach(user => {
      if (!allUsersMap[user]) {
        allUsersMap[user] = INTEGERS.ZERO;
      }

      const points = struct.userToPointsMap[user];
      totalUserPoints = totalUserPoints.plus(points);
      allUsersMap[user] = allUsersMap[user].plus(points);
      return allUsersMap;
    }, {});
  });

  return Object.keys(allUsersMap).reduce((memo, user) => {
    const points = allUsersMap[user];
    memo[user] = TOTAL_DOLO_TOKENS.times(points).dividedToIntegerBy(totalUserPoints).toFixed(0);
    return memo;
  }, {} as Record<string, string>);
}

function writeOutputFile(
  fileContent: any,
): void {
  if (!fs.existsSync(FOLDER_NAME)) {
    fs.mkdirSync(FOLDER_NAME);
  }

  fs.writeFileSync(
    OUTPUT_FILE_NAME,
    JSON.stringify(fileContent),
    { encoding: 'utf8', flag: 'w' },
  );
}

if (isScript()) {
  calculateRegularAirdrop()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while starting:', error);
      process.exit(1);
    });
}
