import { BigNumber, ConfirmationType } from '@dolomite-exchange/dolomite-margin';
import {
  FeeRebateClaimerProxy,
  FeeRebateRollingClaimsProxy,
} from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import FeeRebateClaimerAbi from '../../abi/fee-rebate-claimer.json';
import FeeRebateRollingClaimsAbi from '../../abi/fee-rebate-rolling-claims.json';
import { getGasPriceWei } from '../../helpers/gas-price-helpers';
import { dolomite } from '../../helpers/web3';
import { ApiMarket } from '../api-types';
import { delay } from '../delay';
import Logger from '../logger';
import MarketStore from '../stores/market-store';
import { ONE_DOLLAR } from '../constants';

const WAIT_DURATION_MILLIS = 10 * 60 * 1_000; // 10 minutes

export default class BorrowFeeSweeperUpdater {
  private lastSweptEpoch: number;

  constructor(
    private readonly marketStore: MarketStore,
    private readonly networkId: number,
  ) {
    this.lastSweptEpoch = -1;
  }

  start = () => {
    Logger.info({
      at: 'BorrowFeeSweeperUpdater#start',
      message: 'Starting borrow fee sweeper updater',
    });
    delay(Number(WAIT_DURATION_MILLIS))
      .then(() => this._poll())
      .catch(() => this._poll());
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
      } catch (e: any) {
        Logger.error({
          at: 'BorrowFeeSweeperUpdater#_poll',
          message: `Could not sweep borrow fees due to error: ${e.message}`,
        });
      }

      await delay(WAIT_DURATION_MILLIS);
    }
  };

  _update = async () => {
    Logger.info({
      at: 'BorrowFeeSweeperUpdater#_update',
      message: 'Starting update...',
    });

    const marketMap = this.marketStore.getMarketMap();
    const marketIds = Object.keys(marketMap);

    if (marketIds.length === 0) {
      Logger.info({
        at: 'BorrowFeeSweeperUpdater#_update',
        message: 'No markets found, skipping...',
      });
      return;
    }

    const claimerAddress = (FeeRebateClaimerProxy as any)[this.networkId]?.address;
    if (!claimerAddress) {
      Logger.warn({
        at: 'BorrowFeeSweeperUpdater#_update',
        message: 'FeeRebateClaimerProxy not found for this network',
      });
      return;
    }

    const rollingClaimsAddress = (FeeRebateRollingClaimsProxy as any)[this.networkId]?.address;
    if (!rollingClaimsAddress) {
      Logger.warn({
        at: 'BorrowFeeSweeperUpdater#_update',
        message: 'FeeRebateRollingClaimsProxy not found for this network',
      });
      return;
    }

    const claimer = new dolomite.web3.eth.Contract(FeeRebateClaimerAbi as any, claimerAddress);

    const claimerEpochRaw = await dolomite.contracts.callConstantContractFunction<string>(claimer.methods.epoch());

    const claimerEpoch = Number(claimerEpochRaw);

    const rollingClaims = new dolomite.web3.eth.Contract(FeeRebateRollingClaimsAbi as any, rollingClaimsAddress);
    const rollingClaimsEpochRaw = await dolomite.contracts.callConstantContractFunction<string>(
      rollingClaims.methods.currentEpoch(),
    );
    const rollingClaimsEpoch = Number(rollingClaimsEpochRaw);

    Logger.info({
      at: 'BorrowFeeSweeperUpdater#_update',
      message: 'Checking epochs',
      claimerEpoch,
      rollingClaimsEpoch,
      lastSweptEpoch: this.lastSweptEpoch,
    });

    if (claimerEpoch !== rollingClaimsEpoch) {
      Logger.info({
        at: 'BorrowFeeSweeperUpdater#_update',
        message: 'Epochs are not in sync, skipping...',
        claimerEpoch,
        rollingClaimsEpoch,
      });
      return;
    }

    if (claimerEpoch <= this.lastSweptEpoch) {
      Logger.info({
        at: 'BorrowFeeSweeperUpdater#_update',
        message: 'Already swept for this epoch, skipping...',
        claimerEpoch,
        lastSweptEpoch: this.lastSweptEpoch,
      });
      return;
    }

    const sweepableAmountsRaw = await dolomite.contracts.callConstantContractFunction<string[]>(
      claimer.methods.getSweepableAmountsByMarketIds(marketIds),
    );

    const minSweepAmountUsd = process.env.MIN_SWEEP_REVENUE_AMOUNT_USD
      ? Number(process.env.MIN_SWEEP_REVENUE_AMOUNT_USD)
      : 100;

    const marketIdsToSweep: string[] = [];
    for (let i = 0; i < marketIds.length; i += 11) {
      const marketId = marketIds[i];
      const amountWei = sweepableAmountsRaw[i];
      const market = marketMap[marketId] as ApiMarket;

      if (!market.oraclePrice) {
        continue;
      }

      const sweepableAmountUsd = new BigNumber(amountWei).times(market.oraclePrice).dividedBy(ONE_DOLLAR);
      if (sweepableAmountUsd.gte(minSweepAmountUsd)) {
        marketIdsToSweep.push(marketId);
      }
    }

    if (marketIdsToSweep.length === 0) {
      Logger.info({
        at: 'BorrowFeeSweeperUpdater#_update',
        message: 'No markets meet the sweep threshold',
      });
      return;
    }

    Logger.info({
      at: 'BorrowFeeSweeperUpdater#_update',
      message: `Sweeping revenue for markets: ${marketIdsToSweep.join(', ')}`,
    });

    const result = await dolomite.contracts.callContractFunction(
      claimer.methods.handlerSweepRevenue(marketIdsToSweep),
      {
        gasPrice: getGasPriceWei().toFixed(),
        confirmationType: ConfirmationType.Hash,
      },
    );

    Logger.info({
      at: 'BorrowFeeSweeperUpdater#_update',
      message: 'Sweep transaction has been sent!',
      hash: result.transactionHash,
    });

    this.lastSweptEpoch = claimerEpoch;
  };
}
