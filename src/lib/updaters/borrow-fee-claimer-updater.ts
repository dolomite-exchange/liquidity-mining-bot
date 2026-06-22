import { ConfirmationType } from '@dolomite-exchange/dolomite-margin';
import { FeeRebateClaimerProxy } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json';
import { readVeDoloRebateMetadataFromApi } from '../../../scripts/lib/api-helpers';
import FeeRebateClaimerAbi from '../../abi/fee-rebate-claimer.json';
import { getGasPriceWei } from '../../helpers/gas-price-helpers';
import { dolomite } from '../../helpers/web3';
import { ChainId } from '../chain-id';
import { delay } from '../delay';
import Logger from '../logger';

const WAIT_DURATION_MILLIS = 60 * 1_000; // 1 minute

/**
 * Claims borrow fees weekly once the epoch rolls over on the FeeRebateClaimer
 */
export default class BorrowFeeClaimerUpdater {
  constructor(
    private readonly networkId: number,
  ) {
  }

  start = () => {
    Logger.info({
      at: 'BorrowFeeClaimerUpdater#start',
      message: 'Starting borrow fee claimer updater',
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
          at: 'BorrowFeeClaimerUpdater#_poll',
          message: `Could not sweep borrow fees due to error: ${e.message}`,
        });
      }

      await delay(WAIT_DURATION_MILLIS);
    }
  };

  _update = async () => {
    Logger.info({
      at: 'BorrowFeeClaimerUpdater#_update',
      message: 'Starting update...',
    });

    const claimerAddress = (FeeRebateClaimerProxy as any)[this.networkId]?.address;
    if (!claimerAddress) {
      Logger.warn({
        at: 'BorrowFeeClaimerUpdater#_update',
        message: 'FeeRebateClaimerProxy not found for this network',
      });
      return;
    }

    const claimer = new dolomite.web3.eth.Contract(FeeRebateClaimerAbi as any, claimerAddress);
    const claimerEpochRaw = await dolomite.contracts.callConstantContractFunction<string>(claimer.methods.currentEpoch());
    const claimerEpoch = Number(claimerEpochRaw);

    const metadata = await readVeDoloRebateMetadataFromApi();

    Logger.info({
      at: 'BorrowFeeClaimerUpdater#_update',
      message: 'Checking epochs',
      claimerEpoch,
      serverEpoch: metadata.currentEpochIndex,
    });

    const rebateInfo = metadata.allChainRebateInfo[dolomite.networkId as ChainId];
    const startEpoch = rebateInfo?.startEpoch;
    if (!rebateInfo || !startEpoch || metadata.currentEpochIndex < startEpoch) {
      Logger.info({
        at: 'BorrowFeeClaimerUpdater#_update',
        message: 'Claim period has not started yet, skipping...',
      });
      return;
    }

    if (claimerEpoch >= metadata.currentEpochIndex - 1) {
      Logger.info({
        at: 'BorrowFeeClaimerUpdater#_update',
        message: 'Claim period has not passed yet, skipping...',
      });
      return;
    }

    const marketIdsToClaim: string[] = [];
    for (const marketId of Object.keys(rebateInfo.marketToRebateInfo)) {
      const marketRebateInfo = rebateInfo.marketToRebateInfo[marketId];
      if (metadata.currentEpochIndex >= marketRebateInfo.startEpoch) {
        if (!marketRebateInfo.endEpoch || metadata.currentEpochIndex <= marketRebateInfo.endEpoch) {
          marketIdsToClaim.push(marketId);
        }
      }
    }

    if (marketIdsToClaim.length === 0) {
      Logger.info({
        at: 'BorrowFeeClaimerUpdater#_update',
        message: 'No markets available for claiming. Skipping...',
      });
      return;
    }

    Logger.info({
      at: 'BorrowFeeClaimerUpdater#_update',
      message: `Claiming fees for markets: ${marketIdsToClaim.join(', ')}`,
    });

    const result = await dolomite.contracts.callContractFunction(
      claimer.methods.handlerClaimRewardsByEpochAndMarketId(
        /* _epoch = */ claimerEpoch + 1,
        /* _marketIds = */ marketIdsToClaim,
        /* _incrementEpoch = */ true,
      ),
      {
        gasPrice: getGasPriceWei().toFixed(),
        confirmationType: ConfirmationType.Hash,
      },
    );

    Logger.info({
      at: 'BorrowFeeClaimerUpdater#_update',
      message: 'Claim transaction has been sent!',
      hash: result.transactionHash,
    });
  };
}
