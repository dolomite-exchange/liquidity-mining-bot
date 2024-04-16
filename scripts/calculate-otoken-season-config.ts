import fs from 'fs';
import { getLatestBlockNumberByTimestamp } from '../src/clients/blocks';
import './lib/env-reader';

interface OutputFile {
  epochs: {
    [epoch: string]: {
      epoch: number;
      startTimestamp: number;
      endTimestamp: number;
      startBlockNumber: number;
      endBlockNumber: number;
      oTokenAmount: string;
      rewardWeights: Record<string, string>;
      isFinalized: boolean;
    }
  };
}

const FOLDER_NAME = `${__dirname}/config`;
const FILE_NAME = `${FOLDER_NAME}/oarb-season-0.json`;
const ONE_WEEK = 604_800;

async function start() {
  const outputFile = readOutputFile(FILE_NAME);
  const selectedEpoch = parseInt(process.env.EPOCH_NUMBER ?? 'NaN', 10);
  let maxKey = selectedEpoch
  if (isNaN(selectedEpoch)) {
    maxKey = Object.keys(outputFile.epochs).reduce((max, key) => {
      const value = parseInt(key, 10);
      if (value >= 900) {
        return max
      }
      return Math.max(max, parseInt(key, 10))
    }, 0);
  }

  const oldEpoch = outputFile.epochs[maxKey];
  const { startTimestamp, startBlockNumber, endBlockNumber, endTimestamp, oTokenAmount, rewardWeights } = oldEpoch;

  const newEpoch = oldEpoch.isFinalized ? maxKey + 1 : maxKey;
  const newStartTimestamp = oldEpoch.isFinalized ? endTimestamp : startTimestamp;
  const newStartBlockNumber = oldEpoch.isFinalized ? endBlockNumber : startBlockNumber;
  const newEndTimestamp = Math.min(newStartTimestamp + ONE_WEEK, Math.floor(Date.now() / 1000))
  const blockResult = await getLatestBlockNumberByTimestamp(newEndTimestamp);
  const isFinalized = newEndTimestamp === blockResult.timestamp;

  writeOutputFile(FILE_NAME, {
    epochs: {
      ...outputFile.epochs,
      [newEpoch]: {
        epoch: newEpoch,
        startBlockNumber: newStartBlockNumber,
        startTimestamp: newStartTimestamp,
        endBlockNumber: blockResult.blockNumber,
        endTimestamp: blockResult.timestamp,
        oTokenAmount,
        rewardWeights,
        isFinalized,
      },
    },
  });

  return true;
}

function readOutputFile(fileName: string): OutputFile {
  try {
    return JSON.parse(fs.readFileSync(fileName, 'utf8')) as OutputFile;
  } catch (e) {
    return {
      epochs: {},
    };
  }
}

function writeOutputFile(
  fileName: string,
  fileContent: OutputFile,
): void {
  if (!fs.existsSync(FOLDER_NAME)) {
    fs.mkdirSync(FOLDER_NAME);
  }

  fs.writeFileSync(
    fileName,
    JSON.stringify(fileContent, null, 2),
    { encoding: 'utf8', flag: 'w' },
  );
}

start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
