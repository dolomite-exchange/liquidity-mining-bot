import { calculateAssetHeldForDuration } from '../calculate-assets-held-for-duration';
import { requireIsArbitrumNetwork } from './utils';

const GRAI_MARKET_ID = 46;
const USDM_MARKET_ID = 48;
const RS_ETH_MARKET_ID = 49;
const WO_ETH_MARKET_ID = 53;

async function executeArbStipFlow() {
  requireIsArbitrumNetwork();
  await calculateAssetHeldForDuration(GRAI_MARKET_ID);
  await calculateAssetHeldForDuration(USDM_MARKET_ID);
  await calculateAssetHeldForDuration(RS_ETH_MARKET_ID);
  await calculateAssetHeldForDuration(WO_ETH_MARKET_ID);
}

executeArbStipFlow()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while running:', error);
    process.exit(1);
  });
