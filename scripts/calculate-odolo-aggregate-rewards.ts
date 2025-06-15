import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { dolomite } from '../src/helpers/web3';
import { ChainId } from '../src/lib/chain-id';
import { isScript, shouldForceUpload } from '../src/lib/env'
import Logger from '../src/lib/logger';
import { readODoloMetadataFromApi } from './lib/api-helpers';
import { getOTokenFinalizedFileNameWithPath, getSeasonForOTokenType } from './lib/config-helper';
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

export async function calculateOdoloAggregateRewards(
  epoch: number = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10),
): Promise<{
  epoch: number;
  merkleRoot: string | null
}> {
  const networkId = dolomite.networkId;

  if (Number.isNaN(epoch)) {
    return Promise.reject(new Error(`Invalid EPOCH_NUMBER, found: ${epoch}`));
  }

  const oDoloConfig = await readODoloMetadataFromApi(epoch);

  const allNetworks = Object.keys(oDoloConfig.allChainWeights)
    .filter(c => Object.values(oDoloConfig.allChainWeights[c]).length > 0)
    .map(c => Number(c) as ChainId);

  const allFiles: [ChainId, ODoloOutputFile][] = (
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

  // The week is over if the block is at the end OR if the next block goes into next week
  const isReadyToPostData = allFiles.length === allNetworks.length;
  if (!isReadyToPostData) {
    // There's nothing to do. The week has not passed yet
    Logger.info({
      file: __filename,
      message: 'Epoch has not passed yet. Returning...',
    });
    return { epoch, merkleRoot: null };
  }

  Logger.info({
    file: __filename,
    message: `DolomiteMargin data for aggregating oDOLO rewards`,
    epochNumber: epoch,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  const chainToUserToAmountMap: Record<string, Record<string, string>> = {};
  const metadataPerNetwork: Record<string, ODoloMetadataPerNetwork> = {};
  const userToOTokenRewards: Record<string, Integer> = allFiles.reduce((memo, [chainId, file]) => {
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

  const { merkleRoot, walletAddressToLeafMap } = await calculateMerkleRootAndLeafs(userToOTokenRewards);
  const walletAddressToUserMap = Object.keys(walletAddressToLeafMap).reduce((acc, user) => {
    acc[user] = {
      ...walletAddressToLeafMap[user],
      amountPerNetwork: Object.keys(chainToUserToAmountMap).reduce((acc, chain) => {
        acc[chain] = chainToUserToAmountMap[chain][user] ?? INTEGERS.ZERO.toFixed();
        return acc;
      }, {}),
    }
    return acc;
  }, {} as Record<string, ODoloAggregateUserData>);


  const oTokenFileName = getOTokenFinalizedFileNameWithPath(networkId, ODOLO_TYPE, epoch);
  const oTokenOutputFile: ODoloAggregateOutputFile = {
    users: walletAddressToUserMap,
    metadata: {
      totalUsers: Object.keys(walletAddressToLeafMap).length,
      epoch,
      merkleRoot,
      metadataPerNetwork,
    },
  };

  if (!isScript() || shouldForceUpload()) {
    await writeFileToGitHub(oTokenFileName, oTokenOutputFile, false);
  } else {
    Logger.info({
      file: __filename,
      message: 'Skipping output file upload due to script execution',
    });
    const season = getSeasonForOTokenType(ODOLO_TYPE);
    writeOutputFile(`${ODOLO_TYPE}-${networkId}-season-${season}-epoch-${epoch}-output.json`, oTokenOutputFile);
  }

  return { epoch, merkleRoot };
}

if (isScript()) {
  calculateOdoloAggregateRewards()
    .then(() => {
      console.log('Finished executing script!');
    })
    .catch(error => {
      console.error('Caught error while running:', error);
      process.exit(1);
    });
}
