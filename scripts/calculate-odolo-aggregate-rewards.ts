import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import { readODoloMetadataFromApi } from './lib/api-helpers';
import { getODoloAggregatedFileNameWithPath, getOTokenFinalizedFileNameWithPath } from './lib/config-helper';
import {
  ODoloAggregateOutputFile,
  ODoloAggregateUserData,
  ODoloMetadataPerNetwork,
  ODoloOutputFile,
  OTokenType,
} from './lib/data-types';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './lib/file-helpers';
import { calculateMerkleRootAndLeafs } from './lib/utils';

const ODOLO_TYPE = OTokenType.oDOLO;

async function getODoloPerNetworkFiles(
  allNetworks: ChainId[],
  epoch: number,
): Promise<[ChainId, ODoloOutputFile][]> {
  return (
    await Promise.all(
      allNetworks.map(n =>
        readFileFromGitHub<ODoloOutputFile>(getOTokenFinalizedFileNameWithPath(n, ODOLO_TYPE, epoch))
          .then(f => [n, f] as [ChainId, ODoloOutputFile])
          .catch(e => {
            if (e?.response?.status === 404) {
              return undefined;
            }
            return Promise.reject(e);
          }),
      ),
    )
  ).filter((value): value is [ChainId, ODoloOutputFile] => !!value);
}

function reduceAllNetworkFilesByUser(
  allFiles: [ChainId, ODoloOutputFile][],
): {
  userToAmountMap: Record<string, Integer>;
  chainToUserToAmountMap: Record<string, Record<string, string>>;
  metadataPerNetwork: Record<string, ODoloMetadataPerNetwork>
} {
  const chainToUserToAmountMap: Record<string, Record<string, string>> = {};
  const metadataPerNetwork: Record<string, ODoloMetadataPerNetwork> = {};
  const userToAmountMap = allFiles.reduce((memo, [chainId, file]) => {
    chainToUserToAmountMap[chainId] = {};
    metadataPerNetwork[chainId] = {
      totalUsers: file.metadata.totalUsers,
      amount: INTEGERS.ZERO.toFixed(),
    };
    Object.keys(file.users).forEach(user => {
      const userAmount = file.users[user].amount;
      if (!memo[user]) {
        memo[user] = INTEGERS.ZERO;
      }

      chainToUserToAmountMap[chainId][user] = userAmount;
      metadataPerNetwork[chainId].amount = new BigNumber(metadataPerNetwork[chainId].amount).plus(userAmount).toFixed();

      memo[user] = memo[user].plus(userAmount);
    });
    return memo;
  }, {} as Record<string, Integer>);

  return {
    chainToUserToAmountMap,
    metadataPerNetwork,
    userToAmountMap,
  };
}

export async function calculateODoloAggregateRewards(
  epochNumber: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
): Promise<{
  epoch: number;
  merkleRoot: string | null
}> {
  const networkId = dolomite.networkId;

  if (Number.isNaN(epochNumber)) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epochNumber}`));
  }

  const oDoloConfig = await readODoloMetadataFromApi(epochNumber);

  const allNetworks = Object.keys(oDoloConfig.allChainWeights)
    .filter(c => Object.values(oDoloConfig.allChainWeights[c]).length > 0)
    .map(c => Number(c) as ChainId);

  const allFiles: [ChainId, ODoloOutputFile][] = await getODoloPerNetworkFiles(allNetworks, epochNumber);

  // The week is over if the block is at the end OR if the next block goes into next week
  const isReadyToPostData = allFiles.length === allNetworks.length;
  if (!isReadyToPostData) {
    // There's nothing to do. The week has not passed yet
    Logger.info({
      file: __filename,
      message: 'Epoch has not passed yet. Returning...',
    });
    return { epoch: epochNumber, merkleRoot: null };
  }

  const oDoloAggregatedFileName = getODoloAggregatedFileNameWithPath(networkId);
  if (epochNumber !== 0) {
    const previousFile = await readFileFromGitHub<ODoloAggregateOutputFile>(oDoloAggregatedFileName);
    if (previousFile.metadata.epoch !== epochNumber - 1) {
      // There's nothing to do. The epochs do not align
      Logger.info({
        file: __filename,
        message: 'Aggregated output does not match. Returning...',
      });
      return { epoch: epochNumber, merkleRoot: null };
    }
  }

  Logger.info({
    file: __filename,
    message: `DolomiteMargin data for aggregating oDOLO rewards`,
    epochNumber: epochNumber,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  const {
    userToAmountMap: userToOTokenRewards,
    chainToUserToAmountMap,
    metadataPerNetwork,
  } = reduceAllNetworkFilesByUser(allFiles);

  let totalODolo = INTEGERS.ZERO;
  allFiles.forEach(([_, file]) => {
    totalODolo = totalODolo.plus(file.metadata.totalODolo);
  });

  let cumulativeODolo = INTEGERS.ZERO;
  const { merkleRoot, walletAddressToLeafMap } = await calculateMerkleRootAndLeafs(userToOTokenRewards);
  const walletAddressToUserMap = Object.keys(walletAddressToLeafMap).reduce((acc, user) => {
    cumulativeODolo = cumulativeODolo.plus(walletAddressToLeafMap[user].amount);
    acc[user] = {
      ...walletAddressToLeafMap[user],
      amountPerNetwork: Object.keys(chainToUserToAmountMap).reduce((acc, chain) => {
        acc[chain] = chainToUserToAmountMap[chain][user] ?? INTEGERS.ZERO.toFixed();
        return acc;
      }, {}),
    }
    return acc;
  }, {} as Record<string, ODoloAggregateUserData>);


  const oTokenOutputFile: ODoloAggregateOutputFile = {
    users: walletAddressToUserMap,
    metadata: {
      totalUsers: Object.keys(walletAddressToLeafMap).length,
      totalODolo: totalODolo.toFixed(),
      cumulativeODolo: cumulativeODolo.toFixed(),
      epoch: epochNumber,
      merkleRoot,
      metadataPerNetwork,
    },
  };

  if (!isScript() || shouldForceUpload()) {
    await writeFileToGitHub(oDoloAggregatedFileName, oTokenOutputFile, false);
  } else {
    Logger.info({
      file: __filename,
      message: 'Skipping output file upload due to script execution',
    });
    writeOutputFile(`odolo/${ODOLO_TYPE}-${networkId}-aggregated-output.json`, oTokenOutputFile);
  }

  return { epoch: epochNumber, merkleRoot };
}

if (isScript()) {
  calculateODoloAggregateRewards()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
