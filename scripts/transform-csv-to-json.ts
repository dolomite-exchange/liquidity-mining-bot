import csv from 'csv-parser';
import { ethers } from 'ethers';
import { createReadStream } from 'node:fs';
import path from 'path';
import { ChainId } from '../src/lib/chain-id';
import { writeOutputFile } from './lib/file-helpers';

async function transformCsvToJson() {
  const networkId = ChainId.ArbitrumOne;
  const jsonResult = await new Promise<object>((resolve) => {
    const results = {};
    createReadStream(path.join(process.cwd(), 'scripts/output/minerals', `minerals-${networkId}.csv`))
      .pipe(csv({ headers: false }))
      .on('data', (data) => {
        // Parse the number values, replace commas, and convert to BigNumber
        const bigNumber = ethers.utils.parseUnits(data[1].replace(/,/g, ''));
        results[data[0]] = bigNumber.toString();
      })
      .on('end', () => {
        resolve(results);
      });
  });

  writeOutputFile(`minerals-transformations/minerals-${networkId}.json`, jsonResult);
}

transformCsvToJson()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });
