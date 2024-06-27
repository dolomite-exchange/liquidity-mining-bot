import '../src/lib/env'
import { getMineralFinalizedFileNameWithPath } from './lib/config-helper';
import { readFileFromGitHub, writeOutputFile } from './lib/file-helpers';
import { MineralOutputFile } from './lib/data-types';

const DELTA_NUMBER = '9999';

async function start() {
  const networkId = parseInt(process.env.NETWORK_ID ?? '', 10);
  const outputFile = await readFileFromGitHub<MineralOutputFile>(getMineralFinalizedFileNameWithPath(networkId, 1));
  outputFile.metadata.epoch = 9999;
  outputFile.metadata.startTimestamp = 0;
  outputFile.metadata.endTimestamp = 0;
  outputFile.metadata.startBlockNumber = 0;
  outputFile.metadata.endBlockNumber = 0;

  console.log(`Created delta for ${DELTA_NUMBER}!`);

  const outputFileName = `delta-${networkId}-${DELTA_NUMBER}.json`;
  writeOutputFile(outputFileName, outputFile);
}

start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
