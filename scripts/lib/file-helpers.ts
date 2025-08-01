import axios from 'axios';
import fs from 'fs';
import Logger from '../../src/lib/logger';
import { MineralOutputFile, OTokenOutputFile } from './data-types';

const GITHUB_REPOSITORY_API_URL = 'https://api.github.com/repos/dolomite-exchange/liquidity-mining-data';

/**
 * @throws Error if the file is not found
 */
export async function readFileFromGitHub<T>(filePath: string): Promise<T> {
  const headers = {
    Accept: 'application/vnd.github.v3.raw',
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  };
  const response = await axios.get(`${GITHUB_REPOSITORY_API_URL}/contents/${filePath}`, { headers });
  return response.data;
}

export async function writeFileToGitHub(
  filePath: string,
  fileContent: any,
  prettyPrint: boolean,
): Promise<void> {
  if (!process.env.GITHUB_TOKEN) {
    return Promise.reject(new Error('Invalid GITHUB_TOKEN'));
  }

  const headers = {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
    maxBodyLength: Infinity,
  }

  const fileContentEncoded = Buffer.from(JSON.stringify(fileContent, null, prettyPrint ? 2 : undefined))
    .toString('base64');

  const blob = await axios.post(`${GITHUB_REPOSITORY_API_URL}/git/blobs`, {
    content: fileContentEncoded,
    encoding: 'base64',
  }, headers);

  const baseTree = await axios.get(`${GITHUB_REPOSITORY_API_URL}/git/trees/master`, headers);

  const newTree = await axios.post(`${GITHUB_REPOSITORY_API_URL}/git/trees`, {
    base_tree: baseTree.data.sha,
    tree: [
      {
        path: filePath,
        mode: '100644',
        type: 'blob',
        sha: blob.data.sha,
      },
    ],
  }, headers);

  const message = _getCommitMessage(filePath, fileContent);

  const commit = await axios.post(`${GITHUB_REPOSITORY_API_URL}/git/commits`, {
    message,
    parents: [baseTree.data.sha],
    tree: newTree.data.sha,
  }, headers);

  Logger.info({
    at: '#writeFileToGitHub',
    message: 'Committing upload to GitHub',
    commitMessage: message,
    commitHash: commit.data.sha,
  });

  await axios.patch(`${GITHUB_REPOSITORY_API_URL}/git/refs/heads/master`, {
    sha: commit.data.sha,
  }, headers);

  return Promise.resolve();
}

export function readOutputFile(fileName: string): string | undefined {
  const directory = `${process.cwd()}/scripts/output`;
  const fullPath = `${directory}/${fileName}`;
  if (!fs.existsSync(fullPath)) {
    return undefined;
  }

  return fs.readFileSync(`${directory}/${fileName}`).toString();
}

export function writeOutputFile(
  fileName: string,
  fileContent: object,
  space?: string | number,
): void {
  const directory = `${process.cwd()}/scripts/output`;
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }

  fs.writeFileSync(
    `${directory}/${fileName}`,
    JSON.stringify(fileContent, undefined, space),
    { encoding: 'utf8', flag: 'w' },
  );
}

function _getCommitMessage(filePath: string, fileContent: any): string {
  if (filePath.includes('config')) {
    if (filePath.includes('mineral')) {
      return 'AUTOMATED: Updated mineral config';
    } else if (filePath.includes('oarb')) {
      return 'AUTOMATED: Updated oARB config';
    } else {
      return 'AUTOMATED: Updated config';
    }
  } else if (filePath.includes('finalized')) {
    if (filePath.includes('ez-eth')) {
      return 'AUTOMATED: Added latest ez points';
    } else if (filePath.includes('mineral') && !filePath.includes('metadata')) {
      const mineralData = fileContent as MineralOutputFile;
      if (mineralData.metadata.merkleRoot) {
        return `AUTOMATED: Added finalized minerals for epoch ${mineralData.metadata.epoch}`;
      } else {
        return `AUTOMATED: Updated minerals for epoch ${mineralData.metadata.epoch}`;
      }
    } else if (filePath.includes('oarb') && !filePath.includes('metadata')) {
      const oArbData = fileContent as OTokenOutputFile;
      if (fileContent.metadata.merkleRoot) {
        return `AUTOMATED: Added finalized oARB for epoch ${oArbData.metadata.epoch}`;
      } else {
        return `AUTOMATED: Updated oARB for epoch ${oArbData.metadata.epoch}`;
      }
    } else if (filePath.includes('mineral') && filePath.includes('metadata')) {
      return 'AUTOMATED: Updated finalized mineral metadata';
    } else if (filePath.includes('oarb') && filePath.includes('metadata')) {
      return 'AUTOMATED: Updated finalized oARB metadata';
    } else {
      return 'AUTOMATED: Added finalized data';
    }
  } else {
    return 'AUTOMATED: Add large file';
  }
}
