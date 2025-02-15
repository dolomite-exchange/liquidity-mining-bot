import { BigNumber, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import Logger from '../src/lib/logger';
import { PENDLE_TREASURY_MAP } from '../src/lib/pendle/configuration';
import BlockStore from '../src/lib/stores/block-store';
import { readOutputFile, writeOutputFile } from './lib/file-helpers';
import { LiquidityPositionsAndEvents } from './lib/rewards';

interface AllEventsBlob {
  startBlockNumber: number;
  startTimestamp: number;
  endBlockNumber: number;
  endTimestamp: number;
  data: LiquidityPositionsAndEvents;
}

interface UserSnapshot {
  id: string;
  effectiveUser: string;
  timestamp: number;
  balancePar: string;
}

const DIVISOR = new BigNumber('1000000000000000000');

const USDC_MARKET_ID = 17;
const WBTC_MARKET_ID = 4;

const USDC_POOL_ADDRESS = '0x84e0efc0633041aac9d0196b7ac8af3505e8cc32';
const WBTC_POOL_ADDRESS = '0x3055a746e040bd05ad1806840ca0114d632bc7e2';

const MARKET_ID_TO_SY_POOL_MAP = {
  [USDC_MARKET_ID]: USDC_POOL_ADDRESS,
  [WBTC_MARKET_ID]: WBTC_POOL_ADDRESS,
};

const TOTAL_SY_USDC_ALLOCATION = new BigNumber('152388307.23');
const TOTAL_SY_WBTC_ALLOCATION = new BigNumber('33721845.03');

export async function transformAllPendleMineralsToEvents(): Promise<void> {
  const networkId = dolomite.networkId;
  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  } else if (networkId !== ChainId.ArbitrumOne) {
    const message = 'Expected network ID to be 42161 (Arbitrum One)';
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  const allEventsFileName = `/data/all-virtual-events-${networkId}.json`;
  const allEventsBlob = JSON.parse(readOutputFile(allEventsFileName)!) as AllEventsBlob;

  const blockStore = new BlockStore();
  await blockStore._update();

  Logger.info({
    message: 'Getting all Pendle Mineral events',
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  const poolToUserToTotals: Record<string, Record<string, UserSnapshot[]>> = {
    [MARKET_ID_TO_SY_POOL_MAP[USDC_MARKET_ID]]: {},
    [MARKET_ID_TO_SY_POOL_MAP[WBTC_MARKET_ID]]: {},
  };
  let totalSyWbtcUsed = INTEGERS.ZERO;
  let totalSyUsdcUsed = INTEGERS.ZERO;
  for (let i = 10_008; i <= 10_037; i++) {
    const pendleDistribution = JSON.parse(readOutputFile(`pendle/mineral-season-0-epoch-${i}-output.json`)!);

    Object.keys(pendleDistribution['users']).forEach(user => {
      const userBlob = pendleDistribution['users'][user];

      const usdcAmount = new BigNumber(userBlob['marketIdToAmountMap'][USDC_MARKET_ID] ?? '0');
      const usdcAmountDecimal = usdcAmount.div(DIVISOR).toFixed(2);
      totalSyUsdcUsed = totalSyUsdcUsed.plus(usdcAmountDecimal);
      if (!poolToUserToTotals[USDC_POOL_ADDRESS][user]) {
        poolToUserToTotals[USDC_POOL_ADDRESS][user] = [
          {
            id: user,
            effectiveUser: user,
            timestamp: 1736121600 - 1,
            balancePar: usdcAmountDecimal,
          },
        ];
      } else {
        const prevPar = new BigNumber(poolToUserToTotals[USDC_POOL_ADDRESS][user][0].balancePar);
        poolToUserToTotals[USDC_POOL_ADDRESS][user][0].balancePar = prevPar.plus(usdcAmountDecimal).toFixed(2);
      }

      const wbtcAmount = new BigNumber(userBlob['marketIdToAmountMap'][WBTC_MARKET_ID] ?? '0');
      const wbtcAmountDecimal = wbtcAmount.div(DIVISOR).toFixed(2);
      totalSyWbtcUsed = totalSyWbtcUsed.plus(wbtcAmountDecimal);
      if (!poolToUserToTotals[WBTC_POOL_ADDRESS][user]) {
        poolToUserToTotals[WBTC_POOL_ADDRESS][user] = [
          {
            id: user,
            effectiveUser: user,
            timestamp: 1736121600 - 1,
            balancePar: wbtcAmountDecimal,
          },
        ];
      } else {
        const prevPar = new BigNumber(poolToUserToTotals[WBTC_POOL_ADDRESS][user][0].balancePar);
        poolToUserToTotals[WBTC_POOL_ADDRESS][user][0].balancePar = prevPar.plus(wbtcAmountDecimal).toFixed(2);
      }
    });
  }

  const totalUsdcUnused = TOTAL_SY_USDC_ALLOCATION.minus(totalSyUsdcUsed);
  console.log('totalUsdcUnused', totalUsdcUnused.toFixed(2));

  const totalWbtcUnused = TOTAL_SY_WBTC_ALLOCATION.minus(totalSyWbtcUsed);
  console.log('totalWbtcUnused', totalWbtcUnused.toFixed(2));

  const pendleTreasury = PENDLE_TREASURY_MAP[ChainId.ArbitrumOne]!;
  const pendleUsdcTreasurySnapshot = poolToUserToTotals[USDC_POOL_ADDRESS][pendleTreasury][0];
  poolToUserToTotals[USDC_POOL_ADDRESS][PENDLE_TREASURY_MAP[ChainId.ArbitrumOne]!] = [{
    id: pendleUsdcTreasurySnapshot.id,
    effectiveUser: pendleUsdcTreasurySnapshot.effectiveUser,
    timestamp: pendleUsdcTreasurySnapshot.timestamp,
    balancePar: new BigNumber(pendleUsdcTreasurySnapshot.balancePar).plus(totalUsdcUnused).toFixed(2),
  }];

  const pendleWbtcTreasurySnapshot = poolToUserToTotals[WBTC_POOL_ADDRESS][pendleTreasury][0];
  poolToUserToTotals[WBTC_POOL_ADDRESS][PENDLE_TREASURY_MAP[ChainId.ArbitrumOne]!] = [{
    id: pendleWbtcTreasurySnapshot.id,
    effectiveUser: pendleWbtcTreasurySnapshot.effectiveUser,
    timestamp: pendleWbtcTreasurySnapshot.timestamp,
    balancePar: new BigNumber(pendleWbtcTreasurySnapshot.balancePar).plus(totalWbtcUnused).toFixed(2),
  }];

  allEventsBlob.data[USDC_POOL_ADDRESS] = {
    userToLiquiditySnapshots: poolToUserToTotals[USDC_POOL_ADDRESS],
    virtualLiquidityBalances: {},
  };
  allEventsBlob.data[WBTC_POOL_ADDRESS] = {
    userToLiquiditySnapshots: poolToUserToTotals[WBTC_POOL_ADDRESS],
    virtualLiquidityBalances: {},
  };

  console.log('Finishing adding all Pendle data. Saving...');
  writeOutputFile(allEventsFileName, allEventsBlob);
  console.log('Finished saving data to output file!');

  return undefined;
}

transformAllPendleMineralsToEvents()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });
