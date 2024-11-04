import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { ContractConstantCallOptions } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import { getDolomiteMarkets } from '../../clients/dolomite';
import { isMarketIgnored } from '../../helpers/market-helpers';
import { dolomite } from '../../helpers/web3';
import { ApiMarket, MarketIndex } from '../api-types';
import BlockStore from './block-store';
import { ONE_ETH_WEI } from '../constants';
import { delay } from '../delay';
import Logger from '../logger';
import Pageable from '../pageable';
import { chunkArray } from '../utils';

export default class MarketStore {
  private marketMap: { [marketId: string]: ApiMarket };

  constructor(
    private readonly blockStore: BlockStore,
    public skipOraclePriceRetrieval: boolean,
  ) {
    this.marketMap = {};
  }

  public getMarketMap(): { [marketId: string]: ApiMarket } {
    return this.marketMap;
  }

  async getMarketIndexMap(
    marketMap: { [marketId: string]: any },
    options?: ContractConstantCallOptions,
  ): Promise<{ [marketId: string]: MarketIndex }> {
    const marketIds = Object.keys(marketMap);
    const indexCalls = chunkArray(
      marketIds.map(marketId => {
        return {
          target: dolomite.contracts.dolomiteMargin.options.address,
          callData: dolomite.contracts.dolomiteMargin.methods.getMarketCurrentIndex(marketId)
            .encodeABI(),
        };
      }),
      10,
    );

    const indexResults: string[] = [];
    for (let i = 0; i < indexCalls.length; i += 1) {
      const { results: chunkedResults } = await dolomite.multiCall.aggregate(indexCalls[i], options);
      indexResults.push(...chunkedResults);
    }

    return indexResults.reduce<{ [marketId: string]: MarketIndex }>((memo, rawIndexResult, i) => {
      const decodedResults = dolomite.web3.eth.abi.decodeParameters(['uint256', 'uint256', 'uint256'], rawIndexResult);
      memo[marketIds[i]] = {
        marketId: Number(marketIds[i]),
        borrow: new BigNumber(decodedResults[0]).div(ONE_ETH_WEI),
        supply: new BigNumber(decodedResults[1]).div(ONE_ETH_WEI),
      };
      return memo;
    }, {});
  }

  start = () => {
    Logger.info({
      at: 'MarketStore#start',
      message: 'Starting market store',
    });
    this._poll();
  };

  _poll = async () => {
    // noinspection InfiniteLoopJS
    for (; ;) {
      try {
        await this._update();
      } catch (error: any) {
        Logger.error({
          at: 'MarketStore#_poll',
          message: error.message,
          error,
        });
      }

      await delay(Number(process.env.MARKET_POLL_INTERVAL_MS));
    }
  };

  _update = async (rawBlockNumber?: number) => {
    let blockNumber: number;
    if (rawBlockNumber === undefined) {
      blockNumber = this.blockStore.getBlockNumber();
      if (blockNumber === 0) {
        Logger.info({
          at: 'MarketStore#_update',
          message: 'Block number is still 0, returning...',
        });
        return;
      }
    } else {
      blockNumber = rawBlockNumber;
    }

    Logger.info({
      at: 'MarketStore#_update',
      message: 'Updating markets...',
      blockNumber,
    });

    const nextDolomiteMarkets = await Pageable.getPageableValues(async (lastId) => {
      const result = await getDolomiteMarkets(blockNumber, lastId);
      return result.markets
    });

    const nextMarketMap = nextDolomiteMarkets.reduce<{ [marketId: string]: ApiMarket }>((memo, market) => {
      if (isMarketIgnored(market.marketId)) {
        // If any of the market IDs are ignored, then just return
        return memo;
      }

      memo[market.marketId.toString()] = market;
      return memo;
    }, {});

    if (!this.skipOraclePriceRetrieval) {
      const marketPriceCalls = Object.values(nextMarketMap).map(market => {
        return {
          target: dolomite.address,
          callData: dolomite.contracts.dolomiteMargin.methods.getMarketPrice(market.marketId).encodeABI(),
        };
      });

      const { results: marketPriceResults } = await dolomite.multiCall.aggregate(marketPriceCalls, { blockNumber });

      Object.values(nextMarketMap).forEach((market, i) => {
        const oraclePrice = dolomite.web3.eth.abi.decodeParameter('uint256', marketPriceResults[i]);
        market.oraclePrice = new BigNumber(oraclePrice);
      });
    }

    this.marketMap = nextMarketMap

    Logger.info({
      at: 'MarketStore#_update',
      message: 'Finished updating markets',
      blockNumber,
    });
  };
}
