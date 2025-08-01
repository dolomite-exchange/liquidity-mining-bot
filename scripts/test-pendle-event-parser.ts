import '../src/lib/env'
import { NETWORK_ID } from '../src/lib/constants';
import { getPendleSyAddressToLiquidityPositionAndEventsForOToken } from './lib/pendle-event-parser';

async function start() {
  const result = await getPendleSyAddressToLiquidityPositionAndEventsForOToken(
    NETWORK_ID,
    1753315200,
    1753315200 + (86_400 * 7 - 3600),
  );

  console.log('Got results:', result);
}

start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });
