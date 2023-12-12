import v8 from 'v8';
// eslint-disable-next-line
import '../src/lib/env';

import { getDolomiteRiskParams } from './clients/dolomite';
import { dolomite, loadAccounts } from './helpers/web3';
import BlockStore from './lib/block-store';
import DolomiteDetonator from './lib/dolomite-detonator';
import DolomiteRequestUpdater from './lib/dolomite-request-updater';
import GasPriceUpdater from './lib/gas-price-updater';
import {
  checkBigNumber,
  checkBooleanValue,
  checkDuration,
  checkEthereumAddress,
  checkExists,
  checkJsNumber,
  checkPrivateKey,
} from './lib/invariants';
import LevelUpdateRequestCache from './lib/level-update-request-cache';
import LevelUpdateRequestStore from './lib/level-update-request-store';
import Logger from './lib/logger';
import VestingPositionCache from './lib/vesting-position-cache';
import VestingPositionStore from './lib/vesting-position-store';

checkDuration('ACCOUNT_POLL_INTERVAL_MS', 1000);
checkEthereumAddress('ACCOUNT_WALLET_ADDRESS');
checkPrivateKey('ACCOUNT_WALLET_PRIVATE_KEY');
checkBooleanValue('DETONATIONS_ENABLED');
checkExists('ETHEREUM_NODE_URL');
checkBigNumber('GAS_PRICE_ADDITION');
checkBigNumber('GAS_PRICE_MULTIPLIER');
checkBigNumber('GAS_PRICE_POLL_INTERVAL_MS');
checkBigNumber('INITIAL_GAS_PRICE_WEI');
checkBooleanValue('LEVEL_REQUESTS_ENABLED');
checkJsNumber('NETWORK_ID');
checkDuration('LEVEL_REQUESTS_POLL_INTERVAL_MS', 1000);
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
  const vestingPositionStore = new VestingPositionStore(blockStore);
  const vestingPositionCache = new VestingPositionCache();
  const dolomiteDetonator = new DolomiteDetonator(vestingPositionStore, vestingPositionCache, blockStore);
  const requestUpdaterStore = new LevelUpdateRequestStore(blockStore);
  const requestUpdaterCache = new LevelUpdateRequestCache();
  const dolomiteRequestUpdater = new DolomiteRequestUpdater(requestUpdaterStore, requestUpdaterCache, blockStore);
  const gasPriceUpdater = new GasPriceUpdater();

  await loadAccounts();

  await blockStore._update();
  const subgraphBlockNumber = blockStore.getBlockNumber();
  const { riskParams } = await getDolomiteRiskParams(subgraphBlockNumber);
  const networkId = await dolomite.web3.eth.net.getId();

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
    message: 'DolomiteMargin data',
    accountPollInterval: process.env.ACCOUNT_POLL_INTERVAL_MS,
    accountWalletAddress: process.env.ACCOUNT_WALLET_ADDRESS,
    detonationsEnabled: process.env.DETONATIONS_ENABLED,
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    gasPriceMultiplier: process.env.GAS_PRICE_MULTIPLIER,
    gasPriceAddition: process.env.GAS_PRICE_ADDITION,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    initialGasPriceWei: process.env.INITIAL_GAS_PRICE_WEI,
    levelRequestsEnabled: process.env.LEVEL_REQUESTS_ENABLED,
    networkId,
    requestPollInterval: process.env.LEVEL_REQUESTS_POLL_INTERVAL_MS,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  Logger.info({
    message: 'Polling intervals',
    accountPollIntervalMillis: process.env.ACCOUNT_POLL_INTERVAL_MS,
    gasPricePollInterval: process.env.GAS_PRICE_POLL_INTERVAL_MS,
    liquidatePollIntervalMillis: process.env.LIQUIDATE_POLL_INTERVAL_MS,
    marketPollIntervalMillis: process.env.MARKET_POLL_INTERVAL_MS,
    riskParamsPollIntervalMillis: process.env.RISK_PARAMS_POLL_INTERVAL_MS,
  });

  blockStore.start();
  gasPriceUpdater.start();

  if (process.env.DETONATIONS_ENABLED === 'true') {
    vestingPositionStore.start();
    dolomiteDetonator.start();
  }
  if (process.env.LEVEL_REQUESTS_ENABLED === 'true') {
    requestUpdaterStore.start();
    dolomiteRequestUpdater.start();
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
