import axios from 'axios';
import fs from 'fs';
import { OTokenOutputFile } from '../calculate-otoken-rewards';
import { MineralOutputFile } from './config-helper';

const FOLDER_URL = 'https://api.github.com/repos/dolomite-exchange/liquidity-mining-data';

export async function readFileFromGitHub<T>(filePath: string): Promise<T> {
  const headers = {
    Accept: 'application/vnd.github.v3.raw',
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  };
  const response = await axios.get(`${FOLDER_URL}/contents/${filePath}`, { headers });
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
        message = 'AUTOMATED: Updated mineral config';
      } else if (filePath.includes('oarb')) {
        message = 'AUTOMATED: Updated oARB config';
      } else {
        message = 'AUTOMATED: Updated config';
      }
    } else if (filePath.includes('finalized')) {
      if (filePath.includes('ez-eth')) {
        message = 'AUTOMATED: Added latest ez points';
      } else if (filePath.includes('mineral') && !filePath.includes('metadata')) {
        const mineralData = fileContent as MineralOutputFile;
        if (mineralData.metadata.merkleRoot) {
          message = `AUTOMATED: Added finalized minerals for epoch ${mineralData.metadata.epoch}`;
        } else {
          message = `AUTOMATED: Updated minerals for epoch ${mineralData.metadata.epoch}`;
        }
      } else if (filePath.includes('oarb') && !filePath.includes('metadata')) {
        const oArbData = fileContent as OTokenOutputFile;
        if (fileContent.metadata.merkleRoot) {
          message = `AUTOMATED: Added finalized oARB for epoch ${oArbData.metadata.epoch}`;
        } else {
          message = `AUTOMATED: Updated oARB for epoch ${oArbData.metadata.epoch}`;
        }
      } else if (filePath.includes('mineral') && filePath.includes('metadata')) {
        message = `AUTOMATED: Updated finalized mineral metadata`;
      } else if (filePath.includes('oarb') && filePath.includes('metadata')) {
        message = `AUTOMATED: Updated finalized oARB metadata`;
      } else {
        message = 'AUTOMATED: Added finalized data';
      }
    } else {
      message = 'AUTOMATED: Add large file';
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

  return undefined;
}

export function writeOutputFile(
  fileName: string,
  fileContent: object,
): void {
  if (!fs.existsSync(`${__dirname}/../output`)) {
    fs.mkdirSync(`${__dirname}/../output`);
  }

  fs.writeFileSync(
    `${__dirname}/../output/${fileName}`,
    JSON.stringify(fileContent),
    { encoding: 'utf8', flag: 'w' },
  );
}
