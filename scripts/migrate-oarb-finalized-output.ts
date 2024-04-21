import './lib/env-reader';
import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { dolomite } from '../src/helpers/web3';
import TokenAbi from './abis/isolation-mode-factory.json';
import { OTokenEpochMetadata } from './calculate-otoken-rewards';
import { MAX_OARB_KEY_BEFORE_MIGRATIONS, OTokenConfigFile } from './calculate-otoken-season-config';
import {
  getOTokenConfigFileNameWithPath,
  getOTokenFinalizedFileNameWithPath,
  getOTokenMetadataFileNameWithPath,
  OTokenType,
} from './lib/config-helper';
import { readFileFromGitHub, writeFileToGitHub } from './lib/file-helpers';

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
      if (value >= MAX_OARB_KEY_BEFORE_MIGRATIONS) {
        return max
      }
      return Math.max(max, parseInt(key, 10))
    }, 0);
  }

  const marketIdToNameMap = {};
  for (let i = 0; i <= maxKey; i++) {
    await migrateData(networkId, i, oTokenConfigFile, marketIdToNameMap);
  }

  const metadataFile = await readFileFromGitHub<OTokenEpochMetadata>(
    getOTokenMetadataFileNameWithPath(networkId, OTokenType.oARB),
  );
  for (let i = 0; i < metadataFile.deltas.length; i++) {
    const epoch = metadataFile.deltas[i];
    await migrateData(networkId, epoch, oTokenConfigFile, marketIdToNameMap);
  }
}

async function migrateData(
  networkId: number,
  epoch: number,
  oTokenConfigFile: OTokenConfigFile,
  marketIdToNameMap: Record<string, string>,
): Promise<void> {
  console.log(`Performing migration on epoch:`, epoch);
  const outputFilePath = getOTokenFinalizedFileNameWithPath(networkId, OTokenType.oARB, epoch);
  const oldOutputFile = await readFileFromGitHub<OldFinalizedOutputFile>(outputFilePath);
  const epochConfig = oTokenConfigFile.epochs[epoch];
  const marketIds = Object.keys(epochConfig.rewardWeights).map(m => parseInt(m, 10));
  const marketNames = await Promise.all(
    marketIds.map(async marketId => {
      if (marketIdToNameMap[marketId]) {
        return marketIdToNameMap[marketId];
      }
      const tokenAddress = await dolomite.getters.getMarketTokenAddress(new BigNumber(marketId));
      const token = new dolomite.web3.eth.Contract(TokenAbi, tokenAddress);
      marketIdToNameMap[marketId] = await dolomite.contracts.callConstantContractFunction(token.methods.name());
      return marketIdToNameMap[marketId];
    }),
  );
  oldOutputFile.metadata = {
    epoch: epoch,
    merkleRoot: oldOutputFile.metadata.merkleRoot,
    marketNames: marketNames,
    marketTotalPointsForEpoch: (oldOutputFile as any).marketTotalPointsForEpoch,
    marketIds: marketIds,
    startBlock: epochConfig.startBlockNumber,
    endBlock: epochConfig.endBlockNumber,
    startTimestamp: epochConfig.startTimestamp,
    endTimestamp: epochConfig.endTimestamp,
  } as any;

  await writeFileToGitHub(outputFilePath, oldOutputFile, false);
}

migrateOArbFinalizedAmounts()
  .then(() => {
    console.log('Finished executing script!');
    process.exit(0);
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
