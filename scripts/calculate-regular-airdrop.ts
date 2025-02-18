import { BigNumber, Decimal, DolomiteMargin, INTEGERS, Web3 } from '@dolomite-exchange/dolomite-margin';
import ModuleDeployments from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { parseEther } from 'ethers/lib/utils';
import fs from 'fs';
import v8 from 'v8';
import { ChainId } from '../src/lib/chain-id';
import { isScript } from '../src/lib/env';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/stores/market-store';
import { setupRemapping } from './lib/remapper';
import {
  AccountToSubAccountToMarketToBalanceChangeMap,
  addToBlacklist,
  BalanceChangeEvent,
  calculateFinalPoints,
  calculateVirtualLiquidityPoints,
  FinalPointsStruct,
  InterestOperation,
  LiquidityPositionsAndEvents,
  processEventsWithDifferingPointsBasedOnTimestampUntilEndTimestamp,
  VirtualBalanceAndRewardPoints,
} from './lib/rewards';
import { setSubgraphUrl } from '../src/clients/dolomite';
import { setMarketIgnored } from '../src/helpers/market-helpers';

/* eslint-enable */

const OUTPUT_DIRECTORY = `${process.cwd()}/scripts/output/airdrop-results`;
const OUTPUT_FILE_NAME = `${OUTPUT_DIRECTORY}/regular-airdrop-data-all_networks-supply.json`;
const TOTAL_DOLO_TOKENS = new BigNumber(parseEther(`${90_000_000}`).toString());

interface OutputFile {
  users: {
    [walletAddressLowercase: string]: string // big int
  };
  metadata: {
    totalUserPoints: string // big int
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

const LEVEL_TO_MULTIPLIER_MAP: Record<number, BigNumber | undefined> = {
  10: new BigNumber(2),
};

const CHAIN_ID_TO_WEB3_PROVIDER_URL_MAP: Record<ChainId, string | undefined> = {
  [ChainId.ArbitrumOne]: process.env.ARBITRUM_WEB3_PROVIDER,
  [ChainId.Base]: undefined,
  [ChainId.Berachain]: undefined,
  [ChainId.Mantle]: process.env.MANTLE_WEB3_PROVIDER,
  [ChainId.PolygonZkEvm]: process.env.POLYGON_ZKEVM_WEB3_PROVIDER,
  [ChainId.XLayer]: process.env.X_LAYER_WEB3_PROVIDER,
};

const CHAIN_ID_TO_SUBGRAPH_URL_MAP: Record<ChainId, string | undefined> = {
  [ChainId.ArbitrumOne]: process.env.ARBITRUM_SUBGRAPH_URL,
  [ChainId.Base]: undefined,
  [ChainId.Berachain]: undefined,
  [ChainId.Mantle]: process.env.MANTLE_SUBGRAPH_URL,
  [ChainId.PolygonZkEvm]: process.env.POLYGON_ZKEVM_SUBGRAPH_URL,
  [ChainId.XLayer]: process.env.X_LAYER_SUBGRAPH_URL,
};

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
    0: new BigNumber(1),
  },
  [ChainId.Base]: {},
  [ChainId.Berachain]: {},
  [ChainId.Mantle]: {},
  [ChainId.PolygonZkEvm]: {},
  [ChainId.XLayer]: {},
}

const SUPPLY_MULTIPLIER = INTEGERS.ONE;
const BORROW_MULTIPLIER = new BigNumber(1);

const FOLDER_NAME = `${__dirname}/output`;

export async function calculateRegularAirdrop() {
  Logger.info({
    message: 'Calculating regular airdrop...',
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
  });

  const allFinalPoints = [
    ...await getAllPointsByNetworkId(ChainId.ArbitrumOne, false),
    ...await getAllPointsByNetworkId(ChainId.Mantle, false),
    ...await getAllPointsByNetworkId(ChainId.PolygonZkEvm, false),
    ...await getAllPointsByNetworkId(ChainId.XLayer, false),
  ];
  const totalUserPoints = allFinalPoints.reduce((acc, struct) => acc.plus(struct.totalUserPoints), INTEGERS.ZERO);
  const dataToWrite: OutputFile = {
    users: {},
    metadata: {
      totalUserPoints: totalUserPoints.div(parseEther('1').toString()).toFixed(0),
      totalUsers: 0,
    },
  };

  dataToWrite.users = getFinalDoloAllocations(allFinalPoints, getUserXpLevelData());
  dataToWrite.metadata.totalUsers = Object.keys(dataToWrite.users).length;

  writeOutputFile(dataToWrite);

  return true;
}

async function getAllPointsByNetworkId(networkId: ChainId, includeBorrows: boolean): Promise<FinalPointsStruct[]> {
  const metadata = CHAIN_ID_TO_METADATA_MAP[networkId]!;
  const dolomite = new DolomiteMargin(
    new Web3.providers.HttpProvider(CHAIN_ID_TO_WEB3_PROVIDER_URL_MAP[networkId]!),
    networkId,
  );
  setSubgraphUrl(CHAIN_ID_TO_SUBGRAPH_URL_MAP[networkId]!);

  const J_USDC_MARKET_ID = 10;
  if (networkId === ChainId.ArbitrumOne) {
    setMarketIgnored(J_USDC_MARKET_ID, true);
  } else {
    setMarketIgnored(J_USDC_MARKET_ID, false);
  }

  const marketStore = new MarketStore(null as any, true, dolomite);
  await marketStore._update(metadata.endBlockNumber);
  const endMarketMap = marketStore.getMarketMap();
  const endMarketIndexMap = await marketStore.getMarketIndexMap(endMarketMap, { blockNumber: metadata.endBlockNumber });
  const marketIdToValidMarketsMap = Object.keys(endMarketMap).reduce((acc, marketId) => {
    acc[marketId] = INTEGERS.ONE;
    return acc;
  }, {});

  const goArbVesterProxy = ModuleDeployments.GravitaExternalVesterProxy[ChainId.ArbitrumOne];
  if (goArbVesterProxy) {
    addToBlacklist(goArbVesterProxy.address);
  }
  addToBlacklist('0x52256ef863a713Ef349ae6E97A7E8f35785145dE');
  addToBlacklist('0x59f8cad377e4c66473460ce5ee8976760a04f138');
  addToBlacklist('0xa75c21C5BE284122a87A37a76cc6C4DD3E55a1D4');
  addToBlacklist('0xbDEf2b2051E2aE113297ee8301e011FD71A83738');

  await setupRemapping(networkId, metadata.endBlockNumber);
  const supplyAccountToDolomiteBalanceMap = {};
  const allSupplyPriceMap = getAllPricesFromFile(networkId, SUPPLY_MULTIPLIER);
  processEventsWithDifferingPointsBasedOnTimestampUntilEndTimestamp(
    supplyAccountToDolomiteBalanceMap,
    getUserToAccountNumberToAssetToEventsMapFromFile(networkId),
    endMarketIndexMap,
    allSupplyPriceMap,
    metadata.endTimestamp,
    InterestOperation.ADD_POSITIVE,
  );

  const borrowAccountToDolomiteBalanceMap = {};
  const allBorrowPriceMap = getAllPricesFromFile(networkId, BORROW_MULTIPLIER);
  processEventsWithDifferingPointsBasedOnTimestampUntilEndTimestamp(
    borrowAccountToDolomiteBalanceMap,
    getUserToAccountNumberToAssetToEventsMapFromFile(networkId),
    endMarketIndexMap,
    allBorrowPriceMap,
    metadata.endTimestamp,
    InterestOperation.ADD_NEGATIVE,
  );

  const poolToVirtualLiquidityPositionsAndEvents = getPoolAddressToVirtualLiquidityPositionsAndEventsFromFile(
    networkId,
  );

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
  const borrowFinalPoints = calculateFinalPoints(
    networkId,
    borrowAccountToDolomiteBalanceMap,
    marketIdToValidMarketsMap,
    {},
    {},
  );

  if (includeBorrows) {
    return [supplyFinalPoints, borrowFinalPoints];
  }

  return [supplyFinalPoints];
}

function getAllPricesFromFile(networkId: ChainId, extraMultiplier: Decimal): TimestampToMarketToPriceMap {
  const allPriceMapRaw = JSON.parse(fs.readFileSync(
    `${process.cwd()}/scripts/output/data/all-prices-${networkId}.json`,
    'utf8',
  )).data;

  return Object.keys(allPriceMapRaw).reduce((acc, key) => {
    acc[key] = {};
    Object.keys(allPriceMapRaw[key]).forEach(marketId => {
      const inlineMultiplier = CHAIN_TO_MARKET_TO_EXTRA_MULTIPLIER_MAP[networkId][marketId] ?? INTEGERS.ONE;
      const price = new BigNumber(allPriceMapRaw[key][marketId]);
      acc[key][marketId] = price.times(inlineMultiplier).times(extraMultiplier);
    });
    return acc;
  }, {} as TimestampToMarketToPriceMap);
}

function getUserToAccountNumberToAssetToEventsMapFromFile(
  networkId: ChainId,
): AccountToSubAccountToMarketToBalanceChangeMap {
  const userToAccountNumberToAssetToEventsMapRaw = JSON.parse(fs.readFileSync(
    `${process.cwd()}/scripts/output/data/all-events-${networkId}.json`,
    'utf8',
  )).data;

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

function getPoolAddressToVirtualLiquidityPositionsAndEventsFromFile(
  networkId: ChainId,
): Record<string, LiquidityPositionsAndEvents> {
  const poolToVirtualEventsToEventsMapRaw = JSON.parse(fs.readFileSync(
    `${process.cwd()}/scripts/output/data/all-virtual-events-${networkId}.json`,
    'utf8',
  )).data;

  return Object.keys(poolToVirtualEventsToEventsMapRaw)
    .reduce((acc1, pool) => {
      acc1[pool] = {
        userToLiquiditySnapshots: {},
        virtualLiquidityBalances: {},
      };

      Object.keys(poolToVirtualEventsToEventsMapRaw[pool].userToLiquiditySnapshots).forEach(user => {
        const snapshots = poolToVirtualEventsToEventsMapRaw[pool].userToLiquiditySnapshots[user];
        snapshots.forEach(snapshot => {
          if (!acc1[pool].userToLiquiditySnapshots[user]) {
            acc1[pool].userToLiquiditySnapshots[user] = [];
          }
          acc1[pool].userToLiquiditySnapshots[user]!.push({
            id: snapshot.id,
            effectiveUser: snapshot.effectiveUser,
            timestamp: snapshot.timestamp,
            balancePar: new BigNumber(snapshot.balancePar),
          });
        });
      });

      Object.keys(poolToVirtualEventsToEventsMapRaw[pool].virtualLiquidityBalances).forEach(user => {
        const balanceSnapshot = poolToVirtualEventsToEventsMapRaw[pool].virtualLiquidityBalances[user]!;
        acc1[pool].virtualLiquidityBalances[user] = new VirtualBalanceAndRewardPoints(
          balanceSnapshot.effectiveUser,
          balanceSnapshot.lastUpdated,
          new BigNumber(balanceSnapshot.balancePar),
        );
      });

      return acc1;
    }, {} as Record<string, LiquidityPositionsAndEvents>);
}

function getUserXpLevelData(): Record<string, number> {
  return JSON.parse(fs.readFileSync(
    `${process.cwd()}/scripts/output/data/all-level-data.json`,
    'utf8',
  ));
}

function getFinalDoloAllocations(
  finalPointsStructs: FinalPointsStruct[],
  userToLevelMap: Record<string, number>,
) {
  let totalUserPoints = INTEGERS.ZERO;
  // Add supply data
  const allUsersMap = {};

  finalPointsStructs.forEach(struct => {
    Object.keys(struct.userToPointsMap).forEach(user => {
      if (!allUsersMap[user]) {
        allUsersMap[user] = INTEGERS.ZERO;
      }

      const pointsBeforeXp = struct.userToPointsMap[user];
      const points = pointsBeforeXp.times(LEVEL_TO_MULTIPLIER_MAP[userToLevelMap[user]] ?? INTEGERS.ONE);

      totalUserPoints = totalUserPoints.plus(points);
      allUsersMap[user] = allUsersMap[user].plus(points);
    });
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
