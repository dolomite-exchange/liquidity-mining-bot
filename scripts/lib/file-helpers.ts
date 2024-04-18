import { default as axios } from 'axios';
import fs from 'fs';
import { dirname as getDirName } from 'path';

export interface MineralConfigEpoch {
  epoch: number;
  startTimestamp: number;
  endTimestamp: number;
  startBlockNumber: number;
  endBlockNumber: number;
  oTokenAmount: string;
  rewardWeights: Record<string, string>;
  isFinalized: boolean;
}

export interface MineralConfigFile {
  epochs: {
    [epoch: string]: MineralConfigEpoch
  };
}

const FOLDER_URL = 'https://raw.githubusercontent.com/dolomite-exchange/liquidity-mining-bot/master';

export function writeFileLocally(
  filePath: string,
  fileContent: string,
): void {
  fs.mkdirSync(getDirName(filePath), { recursive: true });

  fs.writeFileSync(filePath, fileContent);
}

export async function readFileFromGitHub<T>(filePath: string): Promise<T> {
  const response = await axios.get(`${FOLDER_URL}/${filePath}`);
  return response.data as T;
}

export async function writeLargeFileToGitHub(
  filePath: string,
  fileContent: object,
  prettyPrint: boolean,
): Promise<void> {
  if (!process.env.GITHUB_TOKEN) {
    return Promise.reject(new Error('Invalid GITHUB_TOKEN'));
  }

  try {
    const githubApiUrl = 'https://api.github.com';
    const owner = 'dolomite-exchange';
    const repo = 'liquidity-mining-bot';

    const headers = {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
    }

    const fileContentEncoded = Buffer.from(JSON.stringify(fileContent, null, prettyPrint ? 2 : undefined))
      .toString('base64');

    const blob = await axios.post(`${githubApiUrl}/repos/${owner}/${repo}/git/blobs`, {
      content: fileContentEncoded,
      encoding: 'base64',
    }, headers);

    const baseTree = await axios.get(`${githubApiUrl}/repos/${owner}/${repo}/git/trees/master`, headers);

    const newTree = await axios.post(`${githubApiUrl}/repos/${owner}/${repo}/git/trees`, {
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

    let message: string;
    if (filePath.includes('config')) {
      if (filePath.includes('mineral')) {
        message = 'Updated mineral config';
      } else if (filePath.includes('oarb')) {
        message = 'Updated oARB config';
      } else {
        message = 'Updated config';
      }
    } else if (filePath.includes('finalized')) {
      if (filePath.includes('mineral')) {
        message = 'Added finalized minerals epoch';
      } else if (filePath.includes('oarb')) {
        message = 'Added finalized oARB epoch';
      } else {
        message = 'Added finalized data';
      }
    } else {
      message = 'Add large file';
    }

    const commit = await axios.post(`${githubApiUrl}/repos/${owner}/${repo}/git/commits`, {
      message,
      parents: [baseTree.data.sha],
      tree: newTree.data.sha,
    }, headers);

    await axios.patch(`${githubApiUrl}/repos/${owner}/${repo}/git/refs/heads/master`, {
      sha: commit.data.sha,
    }, headers);

  } catch (err) {
    console.error(err);
  }
}