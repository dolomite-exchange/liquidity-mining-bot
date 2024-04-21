import { BigNumber, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import v8 from 'v8';
import { getLiquidityMiningVestingPositions } from '../src/clients/dolomite';
import { dolomite } from '../src/helpers/web3';
import { ApiLiquidityMiningVestingPosition, ApiLiquidityMiningVestingPositionStatus } from '../src/lib/api-types';
import BlockStore from '../src/lib/block-store';
import Logger from '../src/lib/logger';
import MarketStore from '../src/lib/market-store';
import Pageable from '../src/lib/pageable';
import '../src/lib/env'

function getDiscountToDolomite(p: ApiLiquidityMiningVestingPosition): BigNumber {
  return new BigNumber(1).minus(new BigNumber(p.duration / 86_400 / 7).times(0.025));
}

function getDiscountsToDolomite(positions: ApiLiquidityMiningVestingPosition[]): BigNumber {
  return positions.reduce((acc, p) => {
    return acc.plus(getDiscountToDolomite(p).times(p.oTokenAmount));
  }, INTEGERS.ZERO)
}

async function start() {
  const blockStore = new BlockStore();
  await blockStore._update();
  const marketStore = new MarketStore(blockStore);

  const networkId = await dolomite.web3.eth.net.getId();

  const libraryDolomiteMargin = dolomite.contracts.dolomiteMargin.options.address;
  if (networkId !== Number(process.env.NETWORK_ID)) {
    const message = `Invalid network ID found!\n
    { network: ${networkId} environment: ${Number(process.env.NETWORK_ID)} }`;
    Logger.error(message);
    return Promise.reject(new Error(message));
  }

  Logger.info({
    message: 'DolomiteMargin data',
    dolomiteMargin: libraryDolomiteMargin,
    ethereumNodeUrl: process.env.ETHEREUM_NODE_URL,
    heapSize: `${v8.getHeapStatistics().heap_size_limit / (1024 * 1024)} MB`,
    networkId,
    subgraphUrl: process.env.SUBGRAPH_URL,
  });

  await marketStore._update();

  const blockNumber = blockStore.getBlockNumber();

  const allPositions = await Pageable.getPageableValues(async (lastId) => {
    const result = await getLiquidityMiningVestingPositions(
      blockNumber,
      lastId,
    );
    return result.liquidityMiningVestingPositions;
  });

  type Positions = ApiLiquidityMiningVestingPosition[];
  const result = allPositions.reduce((acc, position) => {
    if (
      position.status === ApiLiquidityMiningVestingPositionStatus.EMERGENCY_CLOSED
      || position.status === ApiLiquidityMiningVestingPositionStatus.FORCE_CLOSED
    ) {
      acc.forfeit.push(position);
    } else if (position.duration === 24_192_000) {
      // max duration
      acc.max.push(position);
    } else if (position.status === ApiLiquidityMiningVestingPositionStatus.CLOSED) {
      acc.otherDone.push(position);
    } else if (position.status === ApiLiquidityMiningVestingPositionStatus.ACTIVE) {
      acc.otherNotDone.push(position);
    }
    return acc;
  }, { max: [] as Positions, otherDone: [] as Positions, otherNotDone: [] as Positions, forfeit: [] as Positions });

  console.log('total free oToken', result.max.reduce((acc, p) => acc.plus(p.oTokenAmount), INTEGERS.ZERO));
  console.log(
    'total DONE non-free oToken',
    result.otherDone.reduce((acc, p) => acc.plus(p.oTokenAmount), INTEGERS.ZERO),
    '\n\tETH spent',
    result.otherDone.reduce((acc, p) => acc.plus(p.otherTokenSpent), INTEGERS.ZERO),
  );
  const nonFreeNotDoneOToken = result.otherNotDone.reduce((acc, p) => acc.plus(p.oTokenAmount), INTEGERS.ZERO);
  console.log(
    'total NOT DONE non-free oToken',
    nonFreeNotDoneOToken,
    '\n\ttotal NOT DONE non-free after discount to Dolomite',
    getDiscountsToDolomite(result.otherNotDone).toFixed(),
  );
  console.log('total forfeit oToken', result.forfeit.reduce((acc, p) => acc.plus(p.oTokenAmount), INTEGERS.ZERO));
  console.log(
    'total oToken length',
    result.forfeit.length + result.otherNotDone.length + result.otherDone.length + result.max.length,
    '\n\ttotal max discount count', result.max.length,
    '\n\ttotal non-max discount count', result.otherNotDone.length + result.otherDone.length,
    '\n\ttotal forfeit count', result.forfeit.length,
  );

  // eslint-disable-next-line max-len
  return true;
}

start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });
