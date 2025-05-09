import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import csv from 'csv-parser';
import { ethers } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { createReadStream } from 'fs';
import { writeOutputFile } from './lib/file-helpers';
import { calculateMerkleRootAndProofs } from './lib/utils';
import BoycoPositions from './output/royco/dolomite_boyco_positions.json';
import DolomiteBoycoData from './output/royco/third_party_vault_amounts.json';
import TotalsByMarketHash from './output/royco/totals_by_market_hash.json';
import Remappings from './output/royco/remappings.json';

interface BoycoPosition {
  account_address: string;
  market_id: string;
  token_1_ids: string[];
  token_1_amounts: number[];
  amount_deposited: string;
}

const CONCRETE_PENDLE_MAP = {
  ['0xac614884b52DbAB8728476b5d50F0D672BaED31F'.toLowerCase()]: true,
  ['0xab659cfa8a179fC305dF3a083f1400E6A230bf15'.toLowerCase()]: true,
  ['0xd84e88AbBe6a44A2ef9B72DE9DEf68317d6DF336'.toLowerCase()]: true,
  ['0xa8aBe7ac0C4bb1adE8B22De6A33691fcEDCbd8d3'.toLowerCase()]: true,
};

const CONCRETE_HOURGLASS_DATA = {
  ['0xa6C318b8b4a0702b4836D75eaE4FA30d4c5383e3'.toLowerCase()]: true,
};

const ADDRESSES_TO_IGNORE_MAP = {
  ['0x3451e9e21dc9705ccaeb0e61971862897818be23'.toLowerCase()]: true,
};

let PENDLE_TOTAL = INTEGERS.ZERO;
let HOURGLASS_TOTAL = INTEGERS.ZERO;

async function readEtherFiCsvData(walletToVeDoloMap: Record<string, Integer | undefined>, csvFile: string) {
  return new Promise<void>((resolve, reject) => {
    createReadStream(`${process.cwd()}/scripts/${csvFile}`)
      .pipe(csv())
      .on('data', ({ wallet, allocation }) => {
        if (Remappings[wallet.toLowerCase()]) {
          wallet = Remappings[wallet.toLowerCase()];
        }

        const amount = new BigNumber(parseEther(allocation).toString());
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

async function readConcreteData(walletToVeDoloMap: Record<string, Integer | undefined>) {
  return new Promise<void>((resolve, reject) => {
    const concreteVeDoloTotal = ethers.utils.parseEther(DolomiteBoycoData.Concrete);
    const concreteBaseFraction = ethers.BigNumber.from('1000000000000');
    createReadStream(`${process.cwd()}/scripts/output/royco/dolomite_concrete_data.csv`)
      .pipe(csv())
      .on('data', ({ wallet, fraction }) => {
        if (Remappings[wallet.toLowerCase()]) {
          wallet = Remappings[wallet.toLowerCase()];
        }

        const fractionBigNumber = ethers.BigNumber.from(fraction);
        const amount = new BigNumber(fractionBigNumber.mul(concreteVeDoloTotal).div(concreteBaseFraction).toString());
        if (amount.gt(INTEGERS.ZERO)) {
          // Only add non-zero amounts
          if (CONCRETE_PENDLE_MAP[wallet.toLowerCase()]) {
            // Pendle data
            PENDLE_TOTAL = PENDLE_TOTAL.plus(amount);
          } else if (CONCRETE_HOURGLASS_DATA[wallet.toLowerCase()]) {
            // Hourglass data
            HOURGLASS_TOTAL = HOURGLASS_TOTAL.plus(amount);
          } else {
            // Other recipients:
            if (!ADDRESSES_TO_IGNORE_MAP[wallet.toLowerCase()]) {
              if (!walletToVeDoloMap[wallet.toLowerCase()]) {
                walletToVeDoloMap[wallet.toLowerCase()] = INTEGERS.ZERO;
              }
              walletToVeDoloMap[wallet.toLowerCase()] = walletToVeDoloMap[wallet.toLowerCase()]!.plus(amount);
            }
          }
        }
      })
      .on('end', () => resolve())
      .on('error', (error) => reject(error));
  });
}

async function readBoycoMarketData(walletToVeDoloMap: Record<string, Integer | undefined>) {
  ((BoycoPositions as any) as BoycoPosition[]).forEach(p => {
    const pointsReceived = ethers.BigNumber.from(p.token_1_amounts[0].toLocaleString(
      'fullwide',
      { useGrouping: false },
    ));
    const totalPointsReceived = parseEther(TotalsByMarketHash.totalReceivedPerMarket[p.market_id]);
    const totalVeDoloAllocated = parseEther(TotalsByMarketHash.totalVeDoloAllocatedPerMarket[p.market_id]);

    const amount = pointsReceived.mul(totalVeDoloAllocated).div(totalPointsReceived);
    if (amount.gt('0')) {
      let wallet = p.account_address;
      if (Remappings[wallet.toLowerCase()]) {
        wallet = Remappings[wallet.toLowerCase()];
      }

      if (!walletToVeDoloMap[wallet.toLowerCase()]) {
        walletToVeDoloMap[wallet.toLowerCase()] = INTEGERS.ZERO;
      }
      walletToVeDoloMap[wallet.toLowerCase()] = walletToVeDoloMap[wallet.toLowerCase()]!.plus(amount.toString());
    }
  })
}

async function calculateBoycoMerkleDistribution() {
  const walletToVeDoloMap: Record<string, Integer> = {};
  await readEtherFiCsvData(walletToVeDoloMap, 'output/royco/etherfi_ebtc_allocations.csv');
  await readEtherFiCsvData(walletToVeDoloMap, 'output/royco/etherfi_weeth_allocations.csv');
  await readConcreteData(walletToVeDoloMap);
  await readBoycoMarketData(walletToVeDoloMap);

  const merkleRootData = await calculateMerkleRootAndProofs(walletToVeDoloMap);

  const veDoloFigures = Object.values(walletToVeDoloMap);
  const totalVeDolo = veDoloFigures.reduce((prev, curr) => prev.plus(curr));
  console.log(
    'Final data:',
    merkleRootData.merkleRoot,
    veDoloFigures.length,
    totalVeDolo.toFixed(),
    PENDLE_TOTAL.toFixed(),
    HOURGLASS_TOTAL.toFixed(),
  );

  const finalResult = {
    metadata: {
      merkleRoot: merkleRootData.merkleRoot,
      veDoloTotal: totalVeDolo.toFixed(),
      pendleTotal: PENDLE_TOTAL.toFixed(),
      hourglassTotal: HOURGLASS_TOTAL.toFixed(),
    },
    userData: merkleRootData.walletAddressToProofsMap,
  }
  writeOutputFile(`royco/boyco-allocations-FINAL.json`, finalResult);
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
