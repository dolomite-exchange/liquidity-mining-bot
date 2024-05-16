import { ConfirmationType } from '@dolomite-exchange/dolomite-margin';
import { MineralDistributor } from '@dolomite-exchange/modules-deployments/src/deploy/deployments.json'
import {
  getMineralConfigFileNameWithPath,
  getMineralFinalizedFileNameWithPath,
  MineralConfigFile,
  MineralOutputFile,
  writeMineralConfigToGitHub,
} from '../../scripts/lib/config-helper';
import { readFileFromGitHub } from '../../scripts/lib/file-helpers';
import MineralDistributorAbi from '../abi/reward-distributor.json';
import { getGasPriceWei } from '../helpers/gas-price-helpers';
import { dolomite } from '../helpers/web3';
import { delay } from './delay';
import Logger from './logger';

const SHORT_WAIT_DURATION_MILLIS = 60 * 1_000; // 60 seconds in millis
const HASH_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';

export default class MineralsMerkleTreeUpdater {
  constructor(private readonly networkId: number) {
  }

  start = () => {
    Logger.info({
      at: 'MineralsMerkleTreeUpdater#start',
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
          at: 'MineralsMerkleTreeUpdater#_poll',
          message: `Could not post merkle root due to error: ${e.message}`,
        });
      }

      await delay(SHORT_WAIT_DURATION_MILLIS);
    }
  };

  _update = async () => {
    Logger.info({
      at: 'MineralsMerkleTreeUpdater#_update',
      message: 'Starting update...',
    });

    const mineralConfigFile = await readFileFromGitHub<MineralConfigFile>(getMineralConfigFileNameWithPath(this.networkId));
    const epochs = Object.keys(mineralConfigFile.epochs);
    for (let i = 0; i < epochs.length; i++) {
      const configForEpoch = mineralConfigFile.epochs[epochs[i]];
      if (configForEpoch.isMerkleRootGenerated && !configForEpoch.isMerkleRootWrittenOnChain) {
        const mineralFile = await readFileFromGitHub<MineralOutputFile>(getMineralFinalizedFileNameWithPath(
          this.networkId,
          configForEpoch.epoch,
        ));
        const merkleRoot = mineralFile.metadata.merkleRoot;
        if (!merkleRoot) {
          Logger.error({
            at: 'MineralsMerkleTreeUpdater#_update',
            message: 'Merkle root was null unexpectedly!',
          });
          continue;
        }

        const distributor = new dolomite.web3.eth.Contract(
          MineralDistributorAbi,
          MineralDistributor[this.networkId].address,
        );
        const foundMerkleRoot = await dolomite.contracts.callConstantContractFunction<string>(
          distributor.methods.getMerkleRootByEpoch(configForEpoch.epoch),
        );

        if (foundMerkleRoot !== HASH_ZERO) {
          Logger.warn({
            at: 'MineralsMerkleTreeUpdater#_update',
            message: 'Merkle root was already set on chain!',
          });
        } else {
          const result = await dolomite.contracts.callContractFunction(
            distributor.methods.handlerSetMerkleRoot(configForEpoch.epoch, merkleRoot),
            {
              gasPrice: getGasPriceWei().toFixed(),
              confirmationType: ConfirmationType.Hash,
            }
          );
          Logger.info({
            at: 'MineralsMerkleTreeUpdater#_update',
            message: 'Merkle root transaction has been sent!',
            hash: result.transactionHash,
          })
        }
        configForEpoch.isMerkleRootWrittenOnChain = true;
        await writeMineralConfigToGitHub(mineralConfigFile, configForEpoch);
      }
    }


    Logger.info({
      at: 'MineralsMerkleTreeUpdater#_update',
      message: `Finished checking for merkle tree root updates`,
    });
  };
}
