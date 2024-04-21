import './lib/env-reader';
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { dolomite } from '../src/helpers/web3';
import TokenAbi from './abis/isolation-mode-factory.json';
import { OTokenConfigFile } from './calculate-otoken-season-config';
import { getOTokenConfigFileNameWithPath, getOTokenFinalizedFileNameWithPath, OTokenType } from './lib/config-helper';
import { readFileFromGitHub } from './lib/file-helpers';

interface OldFinalizedOutputFile {
  users: {
    [walletAddressLowercase: string]: {
      amount: string // big int
      proofs: string[]
    }
  };
  metadata: {
    isFinalized: boolean
    merkleRoot: string
  };
}

async function migrateOArbFinalizedAmounts(): Promise<void> {
  const networkId = dolomite.networkId;
  if (Number.isNaN(networkId)) {
    return Promise.reject(new Error('Invalid network ID'));
  }

  const oTokenConfigFile = await readFileFromGitHub<OTokenConfigFile>(getOTokenConfigFileNameWithPath(
    networkId,
    OTokenType.oARB,
  ));
  const selectedEpoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  let maxKey = selectedEpoch
  if (isNaN(selectedEpoch)) {
    maxKey = Object.keys(oTokenConfigFile.epochs).reduce((max, key) => {
      const value = parseInt(key, 10);
      if (value >= 900) {
        return max
      }
      return Math.max(max, parseInt(key, 10))
    }, 0);
  }

  for (let i = 0; i < maxKey; i++) {
    const oldOutputFile = await readFileFromGitHub<OldFinalizedOutputFile>(getOTokenFinalizedFileNameWithPath(
      networkId,
      OTokenType.oARB,
      i,
    ));
    const epochConfig = oTokenConfigFile.epochs[i];
    const marketIds = Object.keys(epochConfig.rewardWeights).map(m => parseInt(m, 10));
    const marketNames = await Promise.all(
      marketIds.map(async marketId => {
        const tokenAddress = await dolomite.getters.getMarketTokenAddress(new BigNumber(marketId));
        const token = new dolomite.web3.eth.Contract(TokenAbi, tokenAddress);
        return dolomite.contracts.callConstantContractFunction(token.methods.name());
      }),
    );
    oldOutputFile.metadata = {
      epoch: i,
      merkleRoot: oldOutputFile.metadata.merkleRoot,
      marketNames: marketNames,
      marketTotalPointsForEpoch: (oldOutputFile as any).marketTotalPointsForEpoch,
      marketIds: marketIds,
      startBlock: epochConfig.startBlockNumber,
      endBlock: epochConfig.endBlockNumber,
      startTimestamp: epochConfig.startTimestamp,
      endTimestamp: epochConfig.endTimestamp,
    } as any;
  }
}


migrateOArbFinalizedAmounts()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
