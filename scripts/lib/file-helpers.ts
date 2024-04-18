import { default as axios } from 'axios';
import { MineralOutputFile } from '../calculate-mineral-rewards';

const FOLDER_URL = 'https://api.github.com/repos/dolomite-exchange/liquidity-mining-data';

export async function readFileFromGitHub<T>(filePath: string): Promise<T> {
  const headers = {
    Accept: 'application/vnd.github.v3.raw',
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  };
  const response = await axios.get(`${FOLDER_URL}/contents/${filePath}`, { headers });
  return response.data;
}

export async function writeLargeFileToGitHub(
  filePath: string,
  fileContent: any,
  prettyPrint: boolean,
): Promise<void> {
  if (!process.env.GITHUB_TOKEN) {
    return Promise.reject(new Error('Invalid GITHUB_TOKEN'));
  }

  try {
    const headers = {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
    }

    const fileContentEncoded = Buffer.from(JSON.stringify(fileContent, null, prettyPrint ? 2 : undefined))
      .toString('base64');

    const blob = await axios.post(`${FOLDER_URL}/git/blobs`, {
      content: fileContentEncoded,
      encoding: 'base64',
    }, headers);

    const baseTree = await axios.get(`${FOLDER_URL}/git/trees/master`, headers);

    const newTree = await axios.post(`${FOLDER_URL}/git/trees`, {
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
        const mineralData = fileContent as MineralOutputFile;
        if (fileContent.metadata.merkleRoot) {
          message = `Added finalized minerals for epoch ${mineralData.metadata.epoch}`;
        } else {
          message = `Updated minerals for epoch ${mineralData.metadata.epoch}`;
        }
      } else if (filePath.includes('oarb')) {
        const oArbData = fileContent as MineralOutputFile;
        if (fileContent.metadata.merkleRoot) {
          message = `Added finalized oARB for epoch ${oArbData.metadata.epoch}`;
        } else {
          message = `Updated oARB for epoch ${oArbData.metadata.epoch}`;
        }
      } else {
        message = 'Added finalized data';
      }
    } else {
      message = 'Add large file';
    }

    const commit = await axios.post(`${FOLDER_URL}/git/commits`, {
      message,
      parents: [baseTree.data.sha],
      tree: newTree.data.sha,
    }, headers);

    await axios.patch(`${FOLDER_URL}/git/refs/heads/master`, {
      sha: commit.data.sha,
    }, headers);

  } catch (err) {
    console.error(err);
  }
}
