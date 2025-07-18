import v8 from 'v8';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import Logger from '../src/lib/logger';
import BlockStore from '../src/lib/stores/block-store';
import { getBalanceChangingEvents } from './lib/event-parser';
import { readOutputFile, writeOutputFile } from './lib/file-helpers';
import { setupRemapping } from './lib/remapper';
import { AccountToSubAccountToMarketToBalanceChangeMap } from './lib/rewards';

const ORIGINAL_START_BLOCK_NUMBER_MAP: Record<number, number> = {
  [ChainId.ArbitrumOne]: 28_220_369,
  [ChainId.Base]: 10_010_605,
  [ChainId.Mantle]: 63_091_469,
  [ChainId.PolygonZkEvm]: 9_597_567,
  [ChainId.XLayer]: 832_938,
}

interface AllEventsBlob {
  startBlockNumber: number;
  startTimestamp: number;
  endBlockNumber: number;
  endTimestamp: number;
  data: AccountToSubAccountToMarketToBalanceChangeMap;
}

export async function getAllEvents(): Promise<void> {
  const endBlockNumber = Number.parseInt(process.env.END_BLOCK_NUMBER ?? 'NaN', 10);
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

  let allEventsBlob: AllEventsBlob;
  const allEventsFileName = `/data/all-events-${networkId}.json`;
  const allEventsBuffer = await readOutputFile(allEventsFileName);
  if (allEventsBuffer) {
    allEventsBlob = JSON.parse(allEventsBuffer.toString());
  } else {
    allEventsBlob = {
      startBlockNumber: originalStartBlockNumber,
      startTimestamp: originalStartTimestamp,
      endBlockNumber: originalStartBlockNumber,
      endTimestamp: originalStartTimestamp,
      data: {},
    }
  }

  if (endBlockNumber <= allEventsBlob.endBlockNumber) {
    Logger.info({
      message:
        // eslint-disable-next-line max-len
        `All events have been retrieved up to ${allEventsBlob.endBlockNumber} which is greater than the provided block number (${endBlockNumber})`,
      blobEndBlockNumber: allEventsBlob.endBlockNumber,
      requestedEndBlockNumber: endBlockNumber,
    });
    checkEventsOrdering(allEventsBlob);
    return;
  }

  const blockStore = new BlockStore();
  await blockStore._update();

  const startBlockNumber = allEventsBlob.endBlockNumber; // we pick up where the blob left off
  const startTimestamp = allEventsBlob.endTimestamp;

  Logger.info({
    message: 'Getting all events',
    dolomiteMargin: libraryDolomiteMargin,
    endBlock: endBlockNumber.toLocaleString('en-US', { useGrouping: true }),
    endTimestamp: endTimestamp,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    startBlock: startBlockNumber.toLocaleString('en-US', { useGrouping: true }),
    startTimestamp: startTimestamp,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await setupRemapping(networkId, endBlockNumber);

  const accountToSubAccountToAssetToEventsMap = await getBalanceChangingEvents(startBlockNumber, endBlockNumber);

  Object.keys(accountToSubAccountToAssetToEventsMap).forEach(account => {
    Object.keys(accountToSubAccountToAssetToEventsMap[account]!).forEach(subAccount => {
      Object.keys(accountToSubAccountToAssetToEventsMap[account]![subAccount]!).forEach(asset => {
        const events = accountToSubAccountToAssetToEventsMap[account]![subAccount]![asset];

        if (!events || events.length === 0) {
          return;
        }

        if (!allEventsBlob.data[account]) {
          allEventsBlob.data[account] = {};
        }
        if (!allEventsBlob.data[account][subAccount]) {
          allEventsBlob.data[account][subAccount] = {};
        }
        if (!allEventsBlob.data[account][subAccount][asset]) {
          allEventsBlob.data[account][subAccount][asset] = [];
        }

        allEventsBlob.data[account][subAccount][asset].push(...events);
      });
    });
  });

  allEventsBlob.endBlockNumber = endBlockNumber;
  allEventsBlob.endTimestamp = endTimestamp;

  console.log('Finishing adding all events. Saving...');
  writeOutputFile(allEventsFileName, allEventsBlob);
  console.log('Finished saving data to output file!');

  return undefined;
}

function checkEventsOrdering(blob: AllEventsBlob) {
  const serialIdSet: Record<string, boolean> = {};
  let maxSerialId = 1;
  Object.keys(blob.data).forEach(account => {
    Object.keys(blob.data[account]!).forEach(subAccount => {
      Object.keys(blob.data[account]![subAccount]!).forEach(asset => {
        blob.data[account]![subAccount]![asset]!.forEach(event => {
          serialIdSet[event.serialId] = true;
          if (event.serialId > maxSerialId) {
            maxSerialId = event.serialId;
          }
        });
      });
    });
  });
}

getAllEvents()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });
