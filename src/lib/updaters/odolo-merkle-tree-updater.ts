import { ConfirmationType } from '@dolomite-exchange/dolomite-margin';
import { ODoloRollingClaimsProxy } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json'
import { getODoloAggregatedFileNameWithPath } from '../../../scripts/lib/config-helper';
import { ODoloAggregateOutputFile } from '../../../scripts/lib/data-types';
import { readFileFromGitHub } from '../../../scripts/lib/file-helpers';
import ODoloRollingClaimsAbi from '../../abi/odolo-reward-distributor.json';
import { getGasPriceWei } from '../../helpers/gas-price-helpers';
import { dolomite } from '../../helpers/web3';
import { delay } from '../delay';
import Logger from '../logger';

const SHORT_WAIT_DURATION_MILLIS = 60 * 1_000; // 60 seconds in millis

export default class ODoloMerkleTreeUpdater {
  constructor(private readonly networkId: number) {
  }

  start = () => {
    Logger.info({
      at: 'ODoloMerkleTreeUpdater#start',
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
          at: 'ODoloMerkleTreeUpdater#_poll',
          message: `Could not post merkle root due to error: ${e.message}`,
        });
      }

      await delay(SHORT_WAIT_DURATION_MILLIS);
    }
  };

  _update = async () => {
    Logger.info({
      at: 'ODoloMerkleTreeUpdater#_update',
      message: 'Starting update...',
    });

    const oDoloOutputFile = await readFileFromGitHub<ODoloAggregateOutputFile>(
      getODoloAggregatedFileNameWithPath(this.networkId),
    );
    await this._checkConfigFileAndWriteOnChain(oDoloOutputFile);

    Logger.info({
      at: 'ODoloMerkleTreeUpdater#_update',
      message: `Finished checking for merkle tree root updates`,
    });
  };

  _checkConfigFileAndWriteOnChain = async (
    outputFile: ODoloAggregateOutputFile,
  ) => {
    if (!ODoloRollingClaimsProxy[this.networkId]) {
      return Promise.reject(new Error('Invalid network for ODoloRollingClaimsProxy'));
    }

    const distributor = new dolomite.web3.eth.Contract(
      ODoloRollingClaimsAbi,
      ODoloRollingClaimsProxy[this.networkId].address,
    );
    const onchainEpochRaw = await dolomite.contracts.callConstantContractFunction<string>(
      distributor.methods.currentEpoch(),
    );

    const onchainEpoch = Number(onchainEpochRaw);
    const offchainEpoch = outputFile.metadata.epoch;
    if (onchainEpoch === offchainEpoch) {
      Logger.info({
        at: __filename,
        message: 'Merkle root does not need updating',
      });
      return Promise.resolve();
    } else if (onchainEpoch + 1 !== offchainEpoch) {
      return Promise.reject(new Error('Onchain and Offchain epochs do not align!'));
    }

    const result = await dolomite.contracts.callContractFunction(
      distributor.methods.handlerSetMerkleRoot(outputFile.metadata.merkleRoot, offchainEpoch),
      {
        gasPrice: getGasPriceWei().toFixed(),
        confirmationType: ConfirmationType.Hash,
      },
    );
    Logger.info({
      at: 'ODoloMerkleTreeUpdater#_update',
      message: 'Merkle root transaction has been sent!',
      hash: result.transactionHash,
    });
  }
}
