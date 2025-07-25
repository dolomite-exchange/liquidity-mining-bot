import { BigNumber, DolomiteMargin } from '@dolomite-exchange/dolomite-margin';
import { ContractConstantCallOptions } from '@dolomite-exchange/dolomite-margin/dist/src/types';
import { getDolomiteMarkets } from '../../clients/dolomite';
import { isMarketIgnored } from '../../helpers/market-helpers';
import { dolomite as globalDolomite } from '../../helpers/web3';
import { ApiMarket, MarketIndex } from '../api-types';
import { ONE_ETH_WEI } from '../constants';
import { delay } from '../delay';
import Logger from '../logger';
import { aggregateWithExceptionHandler } from '../multi-call-with-exception-handler';
import Pageable from '../pageable';
import { chunkArray } from '../utils';
import BlockStore from './block-store';

export default class MarketStore {
  private marketMap: { [marketId: string]: ApiMarket };

  constructor(
    private readonly blockStore: BlockStore,
    public skipOraclePriceRetrieval: boolean,
    private readonly dolomite: DolomiteMargin = globalDolomite,
  ) {
    this.marketMap = {};
  }

  /**
   * @return marketId to ApiMarket map
   */
  public getMarketMap(): { [marketId: string]: ApiMarket } {
    return this.marketMap;
  }

  /**
   * @return tokenAddress (lower case) to ApiMarket map
   */
  public getTokenAddressToMarketMap(): { [tokenAddressLower: string]: ApiMarket } {
    return Object.keys(this.marketMap).reduce((acc, key) => {
      const market = this.marketMap[key];
      acc[market.tokenAddress] = market;
      return acc;
    }, {} as Record<string, ApiMarket>);
  }

  async getMarketIndexMap(
    marketMap: { [marketId: string]: any },
    options?: ContractConstantCallOptions,
  ): Promise<{ [marketId: string]: MarketIndex }> {
    const marketIds = Object.keys(marketMap);
    const indexCalls = chunkArray(
      marketIds.map(marketId => {
        return {
          target: this.dolomite.contracts.dolomiteMargin.options.address,
          callData: this.dolomite.contracts.dolomiteMargin.methods.getMarketCurrentIndex(marketId).encodeABI(),
        };
      }),
      10,
    );

    const indexResults: string[] = [];
    for (let i = 0; i < indexCalls.length; i += 1) {
      const { results: chunkedResults } = await this.dolomite.multiCall.aggregate(indexCalls[i], options);
      indexResults.push(...chunkedResults);
    }

    return indexResults.reduce<{ [marketId: string]: MarketIndex }>((memo, rawIndexResult, i) => {
      const decodedResults = this.dolomite.web3.eth.abi.decodeParameters(
        ['uint256', 'uint256', 'uint256'],
        rawIndexResult,
      );
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
      networkId: this.dolomite.networkId,
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
          target: this.dolomite.address,
          callData: this.dolomite.contracts.dolomiteMargin.methods.getMarketPrice(market.marketId).encodeABI(),
        };
      });

      const marketPriceResults = await aggregateWithExceptionHandler(marketPriceCalls, { blockNumber });

      const invalidMarketIds: number[] = [];
      Object.values(nextMarketMap).forEach((market, i) => {
        const priceResult = marketPriceResults[i];
        if (!priceResult.success) {
          invalidMarketIds.push(market.marketId);
        } else {
          const oraclePrice = this.dolomite.web3.eth.abi.decodeParameter('uint256', priceResult.returnData);
          market.oraclePrice = new BigNumber(oraclePrice);
        }
      });

      if (invalidMarketIds.length > 0) {
        Logger.warn({
          at: 'MarketStore#_update',
          message: `Found invalid prices!`,
          marketIds: invalidMarketIds.join(', '),
        });
      }
    }

    this.marketMap = nextMarketMap

    Logger.info({
      at: 'MarketStore#_update',
      message: 'Finished updating markets',
      networkId: this.dolomite.networkId,
      blockNumber,
    });
  };
}
