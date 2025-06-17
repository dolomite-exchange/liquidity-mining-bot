import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import csv from 'csv-parser';
import { ethers } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { createReadStream, readFileSync } from 'fs';
import { writeOutputFile } from './lib/file-helpers';
import { calculateMerkleRootAndProofs } from './lib/utils';

const STONE_BTC_TOTAL_POINTS = new BigNumber(parseEther('16014853.558945581765831573').toString());
const STONE_ETH_TOTAL_POINTS = new BigNumber(parseEther('472985448.044011381243781332').toString());

async function readStakestoneCsvData(
  walletToVeDoloMap: Record<string, Integer | undefined>,
  csvFile: string,
  totalVeDolo: Integer,
  totalPoints: Integer,
) {
  const Remappings = readFileSync('./output/royco/remappings.json')
  return new Promise<void>((resolve, reject) => {
    createReadStream(`${process.cwd()}/scripts/${csvFile}`)
      .pipe(csv())
      .on('data', ({ wallet, points: pointsRaw }) => {
        if (Remappings[wallet.toLowerCase()]) {
          wallet = Remappings[wallet.toLowerCase()];
        }

        const points = new BigNumber(parseEther(pointsRaw).toString());
        const amount = points.times(totalVeDolo).dividedToIntegerBy(totalPoints);
        if (amount.gt('0')) {
          // Only add non-zero amounts
          if (!walletToVeDoloMap[wallet.toLowerCase()]) {
            walletToVeDoloMap[wallet.toLowerCase()] = INTEGERS.ZERO;
          }
          walletToVeDoloMap[wallet.toLowerCase()] = walletToVeDoloMap[wallet.toLowerCase()]!.plus(amount.toString());
        }
      })
      .on('end', () => resolve())
      .on('error', (error) => reject(error));
  });
}

async function readSolvData(walletToVeDoloMap: Record<string, Integer | undefined>) {
  const DolomiteBoycoData = JSON.parse(readFileSync('./output/royco/third_party_vault_amounts.json').toString());
  return new Promise<void>((resolve, reject) => {
    const solvVeDoloTotal = ethers.utils.parseEther(DolomiteBoycoData.SolvBTC_Total);
    const basePercentage = parseEther('1');
    createReadStream(`${process.cwd()}/scripts/output/royco/solvbtc_holders.csv`)
      .pipe(csv())
      .on('data', ({ wallet, percentage: percentageRaw }) => {
        const percentage = parseEther(percentageRaw);
        const amount = new BigNumber(percentage.mul(solvVeDoloTotal).div(basePercentage).toString());

        if (!walletToVeDoloMap[wallet.toLowerCase()]) {
          walletToVeDoloMap[wallet.toLowerCase()] = INTEGERS.ZERO;
        }
        walletToVeDoloMap[wallet.toLowerCase()] = walletToVeDoloMap[wallet.toLowerCase()]!.plus(amount);
      })
      .on('end', () => resolve())
      .on('error', (error) => reject(error));
  });
}

async function calculateBoycoMerkleDistribution() {
  const DolomiteBoycoData = JSON.parse(readFileSync('./output/royco/third_party_vault_amounts.json').toString());
  const walletToVeDoloMap: Record<string, Integer> = {};
  await readStakestoneCsvData(
    walletToVeDoloMap,
    'output/royco/stakestone_btc.csv',
    new BigNumber(parseEther(DolomiteBoycoData.StakeStone_Total_BTC).toString()),
    STONE_BTC_TOTAL_POINTS,
  );
  await readStakestoneCsvData(
    walletToVeDoloMap,
    'output/royco/stakestone_eth.csv',
    new BigNumber(parseEther(DolomiteBoycoData.StakeStone_Total_ETH).toString()),
    STONE_ETH_TOTAL_POINTS,
  );
  await readSolvData(walletToVeDoloMap);

  const veDoloFigures = Object.values(walletToVeDoloMap);
  const totalVeDolo = veDoloFigures.reduce((prev, curr) => prev.plus(curr));
  console.log('Calculating merkle root', Object.keys(walletToVeDoloMap).length, totalVeDolo.toFixed());
  const merkleRootData = await calculateMerkleRootAndProofs(walletToVeDoloMap);

  console.log(
    'Final data:',
    merkleRootData.merkleRoot,
    veDoloFigures.length,
    totalVeDolo.toFixed(),
  );

  const finalResult = {
    metadata: {
      merkleRoot: merkleRootData.merkleRoot,
      veDoloTotal: totalVeDolo.toFixed(),
    },
    userData: merkleRootData.walletAddressToProofsMap,
  }
  writeOutputFile(`royco/boyco-partner-allocations-FINAL.json`, finalResult);
}

calculateBoycoMerkleDistribution()
  .then(() => {
    console.error('Finished calculating Boyco distributions...');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Error calculating Boyco distributions...', e);
    process.exit(-1);
  })
