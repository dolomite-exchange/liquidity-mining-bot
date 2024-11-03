import { BigNumber, Decimal, Integer } from '@dolomite-exchange/dolomite-margin';
import sleep from '@dolomite-exchange/zap-sdk/dist/__tests__/helpers/sleep';
import { dolomite } from '../../src/helpers/web3';
import { getWeb3RequestWithBackoff } from './web3-helper';

type Timestamp = string;
type BlockNumber = string;
type MarketId = string;

const TEN = new BigNumber(10);
const TOTAL_DECIMALS = new BigNumber(36);
const MARKET_ID_TO_DECIMALS_MAP: Record<MarketId, Integer> = {};

export async function getAllPricesByBlockNumbers(
  timestampToBlockNumberMap: Record<Timestamp, number>,
): Promise<Record<Timestamp, Record<MarketId, Decimal>>> {
  const result: Record<BlockNumber, Record<MarketId, Decimal>> = {};
  await Promise.all(
    Object.keys(timestampToBlockNumberMap).map(async (timestamp, i) => {
      await sleep(100 * i);
      const blockNumber = timestampToBlockNumberMap[timestamp];
      const marketIdCount = await getWeb3RequestWithBackoff(() => dolomite.getters.getNumMarkets({ blockNumber }));
      result[timestamp] = {};
      for (let marketId = 0; marketId < marketIdCount.toNumber(); marketId++) {
        if (dolomite.networkId !== 42161 || marketId !== 10 || marketIdCount.toNumber() < 44) {
          result[timestamp][marketId] = await getPrice(marketId, blockNumber);
        }
      }
    }),
  );
  return result;
}

async function getPrice(marketId: number, blockNumber: number): Promise<BigNumber> {
  const price = await getWeb3RequestWithBackoff(() => dolomite.getters.getMarketPrice(
    new BigNumber(marketId),
    { blockNumber },
  ));
  const decimals = await getWeb3RequestWithBackoff(() => getDecimalsByMarketId(marketId));
  return price.div(TEN.pow(TOTAL_DECIMALS.minus(decimals)));
}

async function getDecimalsByMarketId(marketId: number): Promise<Integer> {
  if (MARKET_ID_TO_DECIMALS_MAP[marketId]) {
    return MARKET_ID_TO_DECIMALS_MAP[marketId];
  }

  const tokenAddress = await dolomite.getters.getMarketTokenAddress(new BigNumber(marketId));
  const decimals = await dolomite.token.getDecimals(tokenAddress);
  MARKET_ID_TO_DECIMALS_MAP[marketId] = decimals;

  return decimals;
}
