import v8 from 'v8';
// eslint-disable-next-line
import '../src/lib/env';

import { getDolomiteRiskParams } from './clients/dolomite';
import { getSubgraphBlockNumber } from './helpers/block-helper';
import { dolomite, initializeDolomiteLiquidations, loadAccounts } from './helpers/web3';
import AccountStore from './lib/account-store';
import DolomiteLiquidator from './lib/dolomite-liquidator';
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
import { getLiquidationMode, LiquidationMode } from './lib/liquidation-mode';
import LiquidationStore from './lib/liquidation-store';
import Logger from './lib/logger';
import MarketStore from './lib/market-store';
import RiskParamsStore from './lib/risk-params-store';

checkDuration('ACCOUNT_POLL_INTERVAL_MS', 1000);
checkEthereumAddress('ACCOUNT_WALLET_ADDRESS');
checkPrivateKey('ACCOUNT_WALLET_PRIVATE_KEY');
checkBooleanValue('DETONATIONS_ENABLED');
checkExists('ETHEREUM_NODE_URL');
checkBigNumber('GAS_PRICE_ADDITION');
checkBigNumber('GAS_PRICE_MULTIPLIER');
checkBigNumber('GAS_PRICE_POLL_INTERVAL_MS');
checkDuration('INITIAL_GAS_PRICE_WEI', 1);
checkBooleanValue('LEVEL_REQUESTS_ENABLED');
checkJsNumber('NETWORK_ID');
checkDuration('REQUEST_POLL_INTERVAL_MS', 1000);
checkExists('SUBGRAPH_URL');

if (!Number.isNaN(Number(process.env.AUTO_DOWN_FREQUENCY_SECONDS))) {
  Logger.info(`Setting auto kill in ${process.env.AUTO_DOWN_FREQUENCY_SECONDS} seconds...`);
  setTimeout(() => {
    Logger.info('Killing bot now!');
    process.exit(0);
  }, Number(process.env.AUTO_DOWN_FREQUENCY_SECONDS) * 1000);
}

async function start() {
  const marketStore = new MarketStore();
  const accountStore = new AccountStore(marketStore);
  const liquidationStore = new LiquidationStore();
  const riskParamsStore = new RiskParamsStore(marketStore);
  const dolomiteLiquidator = new DolomiteLiquidator(accountStore, marketStore, liquidationStore, riskParamsStore);
  const gasPriceUpdater = new GasPriceUpdater();
  const liquidationMode = getLiquidationMode();

  await loadAccounts();

  const { blockNumber: subgraphBlockNumber } = await getSubgraphBlockNumber();
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
    requestPollInterval: process.env.REQUEST_POLL_INTERVAL_MS,
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

  if (liquidationMode === LiquidationMode.Simple) {
    Logger.info({
      liquidationMode,
      message: 'Simple liquidation variables',
      collateralPreferences: process.env.COLLATERAL_PREFERENCES,
      minAccountCollateralization: process.env.MIN_ACCOUNT_COLLATERALIZATION,
      minOverheadValue: process.env.MIN_VALUE_LIQUIDATED,
      owedPreferences: process.env.OWED_PREFERENCES,
    });
  } else if (liquidationMode === LiquidationMode.SellWithInternalLiquidity) {
    const revertOnFailToSellCollateral = process.env.REVERT_ON_FAIL_TO_SELL_COLLATERAL === 'true';
    const discountUsedText = revertOnFailToSellCollateral ? '(unused)' : '';
    Logger.info({
      liquidationMode,
      message: 'Sell with internal liquidity variables:',
      revertOnFailToSellCollateral: process.env.REVERT_ON_FAIL_TO_SELL_COLLATERAL,
      minOwedOutputAmountDiscount: `${process.env.MIN_OWED_OUTPUT_AMOUNT_DISCOUNT} ${discountUsedText}`,
    });
  } else if (liquidationMode === LiquidationMode.Generic) {
    Logger.info({
      liquidationMode,
      message: 'Generic liquidation mode variables:',
    });
  } else {
    throw new Error(`Invalid liquidation mode: ${liquidationMode}`);
  }

  if (process.env.LIQUIDATIONS_ENABLED === 'true') {
    await initializeDolomiteLiquidations();
  }

  accountStore.start();
  marketStore.start();
  riskParamsStore.start();
  gasPriceUpdater.start();

  if (process.env.LIQUIDATIONS_ENABLED === 'true' || process.env.EXPIRATIONS_ENABLED === 'true') {
    dolomiteLiquidator.start();
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
