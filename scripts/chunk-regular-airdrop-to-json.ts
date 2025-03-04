import { chunkArray } from '../src/lib/utils';
import { readOutputFile, writeOutputFile } from './lib/file-helpers';

const FILE = 'airdrop-results/regular-airdrop-FINAL-FOR-DATABASE.json';

async function transformRegularAirdropToJson() {
  const data = JSON.parse(readOutputFile(FILE)!) as any[];
  const finalResultForDatabase = chunkArray(data, 3_000);

  for (let i = 0; i < finalResultForDatabase.length; i++) {
    writeOutputFile(`airdrop-results/regular-airdrop-FINAL-FOR-DATABASE-${i}.json`, finalResultForDatabase[i]);
  }
}

transformRegularAirdropToJson()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });
