import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import fs from 'fs';
import '../src/lib/env'
import { calculateMerkleRootAndProofs } from './lib/utils';

interface OutputFile {
  epochs: {
    [epoch: string]: {
      [walletAddressLowercase: string]: {
        amount: string // big int
        proofs: string[]
      }
    }
  };
  metadata: {
    [epoch: string]: {
      isFinalized: boolean
      merkleRoot: string
    }
  };
}

const FIXED_EPOCH_NUMBER = '701';
const OLD_EPOCH_NUMBER = '700';
const FINALIZED_FOLDER_NAME = `${__dirname}/finalized`;
const OUTPUT_FOLDER_NAME = `${__dirname}/output`;

const MINIMUM_OARB_AMOUNT_WEI = new BigNumber(ethers.utils.parseEther('0').toString());

function aggregateFile(file: OutputFile, acc: Record<string, BigNumber>): Record<string, BigNumber> {
  Object.keys(file.epochs).forEach(epoch => {
    Object.keys(file.epochs[epoch]).forEach(account => {
      const amount = new BigNumber(file.epochs[epoch][account].amount);
      if (acc[account]) {
        acc[account] = acc[account].plus(amount);
      } else {
        acc[account] = amount;
      }
      return acc;
    });
  });

  return acc;
}

async function start() {
  const walletToFixedAmountMap = aggregateFile(
    readOutputFile(`${OUTPUT_FOLDER_NAME}/oarb-season-0-epoch-${FIXED_EPOCH_NUMBER}-output.json`),
    {}
  );
  const walletToOldAmountMap = aggregateFile(
    readOutputFile(`${OUTPUT_FOLDER_NAME}/oarb-season-0-epoch-${OLD_EPOCH_NUMBER}-output.json`),
    {}
  );

  const walletToDeltasMap: Record<string, BigNumber> = {};
  let total: BigNumber = new BigNumber(0);
  Object.keys(walletToFixedAmountMap).forEach(account => {
    const fixedAmount = walletToFixedAmountMap[account];
    const oldAmount = walletToOldAmountMap[account] ?? new BigNumber(0);
    const delta = fixedAmount.minus(oldAmount);
    if (delta.gt(MINIMUM_OARB_AMOUNT_WEI) && oldAmount.gte(0)) {
      walletToDeltasMap[account] = delta;
      total = total.plus(delta);
    }
  });
  console.log(`Total added to epoch ${FIXED_EPOCH_NUMBER}:`, total.div(1e18).toFixed());

  const accountToValuesMap = await calculateMerkleRootAndProofs(walletToDeltasMap);
  const outputFileName = `${FINALIZED_FOLDER_NAME}/oarb-season-0-epoch-deltas-output.json`;
  const outputFile = readOutputFile(outputFileName);
  outputFile.epochs[FIXED_EPOCH_NUMBER] = accountToValuesMap.walletAddressToProofsMap;
  outputFile.metadata[FIXED_EPOCH_NUMBER] = {
    merkleRoot: accountToValuesMap.merkleRoot,
    isFinalized: true,
  }
  writeOutputFile(outputFileName, outputFile);
}

function readOutputFile(fileName: string): OutputFile {
  try {
    return JSON.parse(fs.readFileSync(fileName, 'utf8')) as OutputFile;
  } catch (e) {
    return {
      epochs: {},
      metadata: {},
    };
  }
}

function writeOutputFile(
  fileName: string,
  fileContent: OutputFile,
): void {
  if (!fs.existsSync(OUTPUT_FOLDER_NAME)) {
    fs.mkdirSync(OUTPUT_FOLDER_NAME);
  }

  fs.writeFileSync(
    fileName,
    JSON.stringify(fileContent),
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
