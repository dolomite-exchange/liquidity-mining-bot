import { BigNumber, Decimal } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { getTimestampToBlockNumberMap } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import Logger from '../src/lib/logger';
import { readOutputFile } from './lib/file-helpers';
import { getWeb3RequestWithBackoff } from './lib/web3-helper';

const ORIGINAL_START_BLOCK_NUMBER_MAP: Record<ChainId, number> = {
  [ChainId.ArbitrumOne]: 28_220_369,
  [ChainId.Base]: 10_010_605,
  [ChainId.Mantle]: 63_091_469,
  [ChainId.PolygonZkEvm]: 9_597_567,
  [ChainId.XLayer]: 832_938,
}

type DailyTimestamp = string;
type AccountMarketId = string;

interface AllPricesBlob {
  startBlockNumber: number;
  startTimestamp: number;
  endBlockNumber: number;
  endTimestamp: number;
  data: Record<DailyTimestamp, Record<AccountMarketId, Decimal>>;
}

const ONE_DAY_SECONDS = 86_400;

function normalizeTimestamp(timestamp: number): number {
  return Math.floor(timestamp / ONE_DAY_SECONDS) * ONE_DAY_SECONDS + ONE_DAY_SECONDS
}

export async function getAllPrices(): Promise<void> {
  const endBlockNumber = Number.parseInt(process.env.END_BLOCK_NUMBER ?? 'NaN');
  if (Number.isNaN(endBlockNumber)) {
    return Promise.reject(new Error('Invalid END_BLOCK_NUMBER'));
  }

  const networkId = dolomite.networkId;
  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  const originalStartBlockNumber = ORIGINAL_START_BLOCK_NUMBER_MAP[networkId];
  const originalStartTimestamp = (await dolomite.web3.eth.getBlock(originalStartBlockNumber)).timestamp;

  const endTimestamp = (await dolomite.web3.eth.getBlock(endBlockNumber)).timestamp;

  const startTimestampNormalized = normalizeTimestamp(originalStartTimestamp);
  const startBlockNormalized = (await getTimestampToBlockNumberMap([startTimestampNormalized]))[startTimestampNormalized];

  const endTimestampNormalized = normalizeTimestamp(endTimestamp);
  const endBlockNormalized = (await getTimestampToBlockNumberMap([endTimestampNormalized]))[endTimestampNormalized];

  let allPricesBlob: AllPricesBlob;
  const allPricesFileName = `/data/all-prices-${networkId}.json`;
  let allEventsBuffer = await readOutputFile(allPricesFileName);
  if (allEventsBuffer) {
    allPricesBlob = JSON.parse(allEventsBuffer.toString());
    Object.keys(allPricesBlob.data).forEach(timestamp => {
      Object.keys(allPricesBlob.data[timestamp]).forEach(marketId => {
        allPricesBlob.data[timestamp][marketId] = new BigNumber(allPricesBlob.data[timestamp][marketId])
      });
    });
  } else {
    allPricesBlob = {
      startBlockNumber: startBlockNormalized,
      startTimestamp: startTimestampNormalized,
      endBlockNumber: startBlockNormalized,
      endTimestamp: startTimestampNormalized,
      data: {},
    }
  }

  const startBlockNumber = allPricesBlob.endBlockNumber; // we pick up where the blob left off
  const startTimestamp = allPricesBlob.endTimestamp;

  Logger.info({
    message: 'Verifying all daily closing prices',
    dolomiteMargin: libraryDolomiteMargin,
    endBlock: endBlockNormalized.toLocaleString('en-US', { useGrouping: true }),
    endTimestamp: endTimestampNormalized,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    startBlock: startBlockNumber.toLocaleString('en-US', { useGrouping: true }),
    startTimestamp: startTimestamp,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  const timestamps: number[] = [];
  for (let i = startTimestampNormalized; i <= endTimestampNormalized; i += ONE_DAY_SECONDS) {
    timestamps.push(i);
  }
  const timestampToBlockNumberMap = await getTimestampToBlockNumberMap(timestamps);
  Logger.info({
    message: `Total timestamps: ${timestamps.length}`,
  });

  for (let timestamp of Object.keys(timestampToBlockNumberMap)) {
    const blockNumber = timestampToBlockNumberMap[timestamp];
    const marketsLength = await getWeb3RequestWithBackoff(() => dolomite.getters.getNumMarkets({ blockNumber }));
    for (let marketId = 0; marketId < marketsLength.toNumber(); marketId++) {
      if (networkId !== 42161 || marketId !== 10 || marketsLength.toNumber() < 44) {
        if (!allPricesBlob.data[timestamp] || !allPricesBlob.data[timestamp][marketId]) {
          throw new Error(`Invalid price at timestamp ${timestamp} for market ID: ${marketId}`)
        }
      }
    }
  }

  Logger.info({
    message: 'Finished validating all prices at all timestamps!',
  })

  return undefined;
}

getAllPrices()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });
