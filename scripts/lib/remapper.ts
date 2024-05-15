import axios from 'axios';
import { ChainId } from '../../src/lib/chain-id';
import { isScript } from '../../src/lib/env';
import Logger from '../../src/lib/logger';
import { readFileFromGitHub, writeFileToGitHub, writeOutputFile } from './file-helpers';

type ProxyUser = string;
type EffectiveUser = string;

export interface RemappingConfig {
  proxyUsers: Record<ProxyUser, EffectiveUser | undefined>
  lastUpdatedAtBlockNumber: number;
}

interface ContangoData {
  owner: string;
  proxy: string;
}

const ACCOUNT_MAP: Record<number, Record<string, string | undefined>> = {}

export function remapAccountToClaimableAccount(chainId: ChainId, account: string): string {
  if (!ACCOUNT_MAP[chainId]) {
    throw new Error(`Account remapping is not setup for ${chainId}`);
  }
  return ACCOUNT_MAP[chainId][account] ?? account;
}

export async function setupRemapping(chainId: ChainId, endBlockNumber: number): Promise<void> {
  const filePath = `config/${chainId}/external-remapping.json`;
  const remapping = await readFileFromGitHub<RemappingConfig>(filePath);
  console.log('remapping', remapping);
  if (remapping.lastUpdatedAtBlockNumber < endBlockNumber) {
    Logger.error({
      at: '#setupRemapping',
      message: 'Updating the remapping file...',
    });
    remapping.lastUpdatedAtBlockNumber = endBlockNumber;

    if (chainId === ChainId.ArbitrumOne) {
      try {
        const response = await axios.get<ContangoData[]>(`https://points.contango.xyz:6060/dolomite?block=${endBlockNumber}`);
        response.data.forEach(({ owner, proxy }) => {
          remapping.proxyUsers[proxy.toLowerCase()] = owner.toLowerCase();
        });
      } catch (e) {
        Logger.error({
          at: '#setupRemapping',
          message: 'Could not get Contango remapping',
          error: e,
        });
      }
    }

    if (isScript()) {
      const fileName = 'external-remapping.json';
      console.log('Writing external remapping to file:', fileName);
      writeOutputFile(fileName, remapping);
    } else {
      await writeFileToGitHub(filePath, remapping, false);
    }
  }

  ACCOUNT_MAP[chainId] = remapping.proxyUsers;
}
