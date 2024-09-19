import { calculateAssetHeldForDuration } from '../calculate-assets-held-for-duration';
import { requireIsArbitrumNetwork } from './utils';

const PT_E_ETH_SEP_2024_MARKET_ID = 50;
const PT_EZ_ETH_SEP_2024_MARKET_ID = 51;
const PT_RS_ETH_SEP_2024_MARKET_ID = 52;

async function executeArbStipFlow() {
  requireIsArbitrumNetwork();
  await calculateAssetHeldForDuration(PT_E_ETH_SEP_2024_MARKET_ID);
  await calculateAssetHeldForDuration(PT_EZ_ETH_SEP_2024_MARKET_ID);
  await calculateAssetHeldForDuration(PT_RS_ETH_SEP_2024_MARKET_ID);
}

executeArbStipFlow()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while running:', error);
    process.exit(1);
  });
