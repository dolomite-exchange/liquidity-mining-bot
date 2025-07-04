import v8 from 'v8';
// eslint-disable-next-line
import '../src/lib/env';

import { getDolomiteRiskParams } from './clients/dolomite';
import { dolomite, loadAccounts } from './helpers/web3';
import LevelUpdateRequestCache from './lib/caches/level-update-request-cache';
import VestingPositionCache from './lib/caches/vesting-position-cache';
import {
  checkBigNumber,
  checkBooleanValue,
  checkConditionally,
  checkDuration,
  checkEthereumAddress,
  checkExists,
  checkJsNumber,
  checkMarketIdList,
  checkPrivateKey,
} from './lib/invariants';
import Logger from './lib/logger';
import BlockStore from './lib/stores/block-store';
import LevelUpdateRequestStore from './lib/stores/level-update-request-store';
import MarketStore from './lib/stores/market-store';
import VestingPositionStore from './lib/stores/vesting-position-store';
import DolomiteDetonatorUpdater from './lib/updaters/dolomite-detonator-updater';
import DolomiteLevelRequestUpdater from './lib/updaters/dolomite-level-request-updater';
import GasPriceUpdater from './lib/updaters/gas-price-updater';
import MineralsMerkleTreeUpdater from './lib/updaters/minerals-merkle-tree-updater';
import MineralsUpdater from './lib/updaters/minerals-updater';
import ODoloAggregatorUpdater from './lib/updaters/odolo-aggregator-updater';
import ODoloAggregatorMerkleTreeUpdater from './lib/updaters/odolo-merkle-tree-updater';
import ODoloUpdater from './lib/updaters/odolo-updater';
import PendleMineralsUpdater from './lib/updaters/pendle-minerals-updater';

checkDuration('ACCOUNT_POLL_INTERVAL_MS', 1000);
checkEthereumAddress('ACCOUNT_WALLET_ADDRESS');
checkPrivateKey('ACCOUNT_WALLET_PRIVATE_KEY');
checkDuration('BLOCK_POLL_INTERVAL_MS', 1000);
checkBooleanValue('BLOCK_STORE_ENABLED');
checkBooleanValue('DETONATIONS_ENABLED');
checkDuration('DETONATIONS_KEY_EXPIRATION_SECONDS', 1, false);
checkDuration('DETONATIONS_POLL_INTERVAL_MS', 1000);
checkExists('ETHEREUM_NODE_URL');
checkExists('ETHERSCAN_API_KEY');
checkBigNumber('GAS_PRICE_ADDITION');
checkBigNumber('GAS_PRICE_MULTIPLIER');
checkBigNumber('GAS_PRICE_POLL_INTERVAL_MS');
checkBooleanValue('GAS_PRICE_UPDATER_ENABLED');
checkConditionally(!!process.env.IGNORED_MARKETS, () => checkMarketIdList('IGNORED_MARKETS', 0));
checkBigNumber('INITIAL_GAS_PRICE_WEI');
checkBooleanValue('LEVEL_REQUESTS_ENABLED');
checkDuration('LEVEL_REQUESTS_KEY_EXPIRATION_SECONDS', 1, false);
checkDuration('LEVEL_REQUESTS_POLL_INTERVAL_MS', 1000, true);
checkBooleanValue('MINERALS_ENABLED');
checkBooleanValue('ODOLO_AGGREGATOR_ENABLED');
checkBooleanValue('ODOLO_ENABLED');
checkJsNumber('NETWORK_ID');
checkBooleanValue('PENDLE_MINERALS_ENABLED');
checkDuration('SEQUENTIAL_TRANSACTION_DELAY_MS', 100);
checkExists('SUBGRAPH_URL');

if (!Number.isNaN(Number(process.env.AUTO_DOWN_FREQUENCY_SECONDS))) {
  Logger.info(`Setting auto kill in ${process.env.AUTO_DOWN_FREQUENCY_SECONDS} seconds...`);
  setTimeout(() => {
    Logger.info('Killing bot now!');
    process.exit(0);
  }, Number(process.env.AUTO_DOWN_FREQUENCY_SECONDS) * 1000);
}

async function start() {
  const blockStore = new BlockStore();
  const marketStore = new MarketStore(blockStore, false);
  const vestingPositionStore = new VestingPositionStore(blockStore);
  const vestingPositionCache = new VestingPositionCache();
  const dolomiteDetonator = new DolomiteDetonatorUpdater(vestingPositionStore, vestingPositionCache, blockStore);
  const requestUpdaterStore = new LevelUpdateRequestStore(blockStore);
  const requestUpdaterCache = new LevelUpdateRequestCache();
  const dolomiteRequestUpdater = new DolomiteLevelRequestUpdater(
    requestUpdaterStore,
    requestUpdaterCache,
    blockStore,
    marketStore,
  );
  const gasPriceUpdater = new GasPriceUpdater();

  await loadAccounts();

  await blockStore._update();
  const subgraphBlockNumber = blockStore.getBlockNumber();
  const { riskParams } = await getDolomiteRiskParams(subgraphBlockNumber);
  const networkId = await dolomite.web3.eth.net.getId();
  const mineralsUpdater = new MineralsUpdater();
  const mineralsMerkleTreeUpdater = new MineralsMerkleTreeUpdater(networkId);
  const pendleMineralsUpdater = new PendleMineralsUpdater();
  const oDoloAggregatorUpdater = new ODoloAggregatorUpdater();
  const oDoloUpdater = new ODoloUpdater();
  const oDoloMerkleTreeUpdater = new ODoloAggregatorMerkleTreeUpdater(networkId);

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address
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
    message: 'Dolomite Liquidity Mining Bot - Environment Data',
    accountPollIntervalMillis: process.env.ACCOUNT_POLL_INTERVAL_MS,
    accountWalletAddress: process.env.ACCOUNT_WALLET_ADDRESS,
    blockPollIntervalMillis: process.env.BLOCK_POLL_INTERVAL_MS,
    blockStoreEnabled: process.env.BLOCK_STORE_ENABLED,
    detonationsEnabled: process.env.DETONATIONS_ENABLED,
    detonationsKeyExpirationSeconds: process.env.DETONATIONS_KEY_EXPIRATION_SECONDS,
    detonationsPollIntervalMillis: process.env.DETONATIONS_POLL_INTERVAL_MS,
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    gasPriceAddition: process.env.GAS_PRICE_ADDITION,
    gasPriceMultiplier: process.env.GAS_PRICE_MULTIPLIER,
    gasPricePollIntervalMillis: process.env.GAS_PRICE_POLL_INTERVAL_MS,
    gasPriceUpdaterEnabled: process.env.GAS_PRICE_UPDATER_ENABLED,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    ignoredMarketsList: process.env.IGNORED_MARKETS?.split(',').map(m => parseInt(m, 10)) ?? [],
    initialGasPriceWei: process.env.INITIAL_GAS_PRICE_WEI,
    levelRequestsEnabled: process.env.LEVEL_REQUESTS_ENABLED,
    levelRequestsKeyExpirationSeconds: process.env.LEVEL_REQUESTS_KEY_EXPIRATION_SECONDS,
    levelRequestsPollIntervalMillis: process.env.LEVEL_REQUESTS_POLL_INTERVAL_MS,
    mineralsEnabled: process.env.MINERALS_ENABLED,
    oDoloAggregatorEnabled: process.env.ODOLO_AGGREGATOR_ENABLED,
    oDoloEnabled: process.env.ODOLO_ENABLED,
    networkId,
    pendleMineralsEnabled: process.env.PENDLE_MINERALS_ENABLED,
    sequentialTransactionDelayMillis: process.env.SEQUENTIAL_TRANSACTION_DELAY_MS,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  if (process.env.BLOCK_STORE_ENABLED === 'true') {
    blockStore.start();
  }
  if (process.env.GAS_PRICE_UPDATER_ENABLED === 'true') {
    gasPriceUpdater.start();
  }
  if (process.env.DETONATIONS_ENABLED === 'true') {
    vestingPositionStore.start();
    dolomiteDetonator.start();
  }
  if (process.env.LEVEL_REQUESTS_ENABLED === 'true') {
    marketStore.start();
    requestUpdaterStore.start();
    dolomiteRequestUpdater.start();
  }
  if (process.env.MINERALS_ENABLED === 'true') {
    mineralsUpdater.start();
    mineralsMerkleTreeUpdater.start();
  }
  if (process.env.ODOLO_ENABLED === 'true') {
    oDoloUpdater.start();
  }
  if (process.env.ODOLO_AGGREGATOR_ENABLED === 'true') {
    oDoloAggregatorUpdater.start();
    oDoloMerkleTreeUpdater.start();
  }
  if (process.env.PENDLE_MINERALS_ENABLED === 'true') {
    pendleMineralsUpdater.start();
  }
  return true
}

start().catch(error => {
  Logger.error({
    message: `Found error while starting: ${error.toString()}`,
    error: JSON.stringify(error),
  })
  process.exit(1)
});
