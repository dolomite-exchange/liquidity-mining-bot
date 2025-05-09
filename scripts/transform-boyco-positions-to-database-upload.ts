import { chunkArray } from '../src/lib/utils';
import { readOutputFile, writeOutputFile } from './lib/file-helpers';

async function filterBoycoPositions() {
  const { userData } = JSON.parse(readOutputFile('royco/boyco-partner-allocations-FINAL.json')!)
  const result = Object.entries(userData).map(([user, data]: [string, any]) => {
    return [user, data.amount, data.proofs];
  });

  const chunks = chunkArray(result, 10_000);
  chunks.forEach((chunk, i) => {
    writeOutputFile(`royco/boyco-partner-allocations-FINAL-DB-${i}.json`, chunk);
  });
}

filterBoycoPositions()
  .then(() => {
    console.error('Finished transforming...');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Error transforming...', e);
    process.exit(-1);
  })
