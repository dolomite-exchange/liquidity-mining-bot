import { ConfirmationType } from '@dolomite-exchange/dolomite-margin';
import { FeeRebateRollingClaimsProxy } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json'
import { getBorrowFeeRebateFileNameWithPath } from '../../../scripts/lib/config-helper';
import { BorrowRebatePerNetworkOutputFile } from '../../../scripts/lib/data-types';
import { readFileFromGitHub } from '../../../scripts/lib/file-helpers';
import FeeRebatingRollingClaimsAbi from '../../abi/fee-rebate-rolling-claims.json';
import { getGasPriceWei } from '../../helpers/gas-price-helpers';
import { dolomite } from '../../helpers/web3';
import { delay } from '../delay';
import Logger from '../logger';

const SHORT_WAIT_DURATION_MILLIS = 60 * 1_000; // 60 seconds in millis

export default class BorrowFeeRebateMerkleTreeUpdater {
  constructor(private readonly networkId: number) {
  }

  start = () => {
    Logger.info({
      at: 'BorrowFeeRebateMerkleTreeUpdater#start',
      message: 'Starting merkle tree updater',
    });
    delay(Number(SHORT_WAIT_DURATION_MILLIS))
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
          at: 'BorrowFeeRebateMerkleTreeUpdater#_poll',
          message: `Could not post merkle root due to error: ${e.message}`,
        });
      }

      await delay(SHORT_WAIT_DURATION_MILLIS);
    }
  };

  _update = async () => {
    Logger.info({
      at: 'BorrowFeeRebateMerkleTreeUpdater#_update',
      message: 'Starting update...',
    });

    const feeRebateOutputFile = await readFileFromGitHub<BorrowRebatePerNetworkOutputFile>(
      getBorrowFeeRebateFileNameWithPath(this.networkId),
    );
    await this._checkConfigFileAndWriteOnChain(feeRebateOutputFile);

    Logger.info({
      at: 'BorrowFeeRebateMerkleTreeUpdater#_update',
      message: 'Finished checking for merkle tree root updates',
    });
  };

  _checkConfigFileAndWriteOnChain = async (
    outputFile: BorrowRebatePerNetworkOutputFile,
  ) => {
    if (!FeeRebateRollingClaimsProxy[this.networkId]) {
      return Promise.reject(new Error('Invalid network for FeeRebateRollingClaimsProxy'));
    }

    const rollingClaimsDistributor = new dolomite.web3.eth.Contract(
      FeeRebatingRollingClaimsAbi,
      FeeRebateRollingClaimsProxy[this.networkId].address,
    );
    const onchainEpochRaw = await dolomite.contracts.callConstantContractFunction<string>(
      rollingClaimsDistributor.methods.currentEpoch(),
    );

    const onchainEpoch = Number(onchainEpochRaw);
    const offchainEpoch = outputFile.metadata.epoch;
    if (onchainEpoch === offchainEpoch) {
      Logger.info({
        at: __filename,
        message: 'Merkle root does not need updating',
      });
      return false;
    } else if (onchainEpoch + 1 !== offchainEpoch) {
      return Promise.reject(new Error('Onchain and Offchain epochs do not align!'));
    }

    const marketIds: string[] = [];
    const merkleRoots: string[] = [];
    const totalAmounts: string[] = [];
    Object.keys(outputFile.metadata.marketToMerkleRoot).forEach((marketId) => {
      marketIds.push(marketId);
      merkleRoots.push(outputFile.metadata.marketToMerkleRoot[marketId]);
      totalAmounts.push(outputFile.metadata.marketToTotalRebate[marketId]);
    });

    const result = await dolomite.contracts.callContractFunction(
      rollingClaimsDistributor.methods.handlerSetMerkleRoots(
        marketIds,
        merkleRoots,
        totalAmounts,
        offchainEpoch,
        /* incrementEpoch = */ true,
      ),
      {
        gasPrice: getGasPriceWei().toFixed(),
        confirmationType: ConfirmationType.Hash,
      },
    );
    Logger.info({
      at: 'BorrowFeeRebateMerkleTreeUpdater#_update',
      message: 'Merkle root transaction has been sent!',
      hash: result.transactionHash,
    });

    return true;
  }
}
