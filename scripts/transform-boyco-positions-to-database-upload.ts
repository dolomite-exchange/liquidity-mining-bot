import { readOutputFile, writeOutputFile } from './lib/file-helpers';

async function filterBoycoPositions() {
  const { userData } = JSON.parse(readOutputFile('royco/boyco-allocations-FINAL.json')!)
  const result = Object.entries(userData).map(([user, data]: [string, any]) => {
    return [user, data.amount, data.proofs];
  });

  writeOutputFile('royco/boyco-allocations-FINAL-DB.json', result);
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
