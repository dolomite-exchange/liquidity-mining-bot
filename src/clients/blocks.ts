/* eslint-disable max-len */
import axios from 'axios';
import { GraphqlDepositsResult } from '../lib/graphql-types';
import '../lib/env';

const defaultAxiosConfig = {
  headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
};

const subgraphUrl = process.env.SUBGRAPH_BLOCKS_URL ?? '';
if (!subgraphUrl) {
  throw new Error('SUBGRAPH_BLOCKS_URL is not set')
}

interface LatestBlockNumberAndTimestamp {
  blockNumber: number;
  timestamp: number;
}

export async function getLatestBlockDataByTimestamp(
  timestamp: number,
): Promise<LatestBlockNumberAndTimestamp> {
  const query = `
  query getLatestBlockDataByTimestamp($timestamp: BigInt) {
    blocks(first: 1, orderBy: number orderDirection: desc where: { timestamp_lte: $timestamp }) {
      timestamp
      number
    }
  }
  `;
  return getBlockDataFromQuery(query, { timestamp });
}

export async function getBlockDataByBlockNumber(
  blockNumber: number,
): Promise<LatestBlockNumberAndTimestamp> {
  const query = `
  query getBlockDataByBlockNumber($blockNumber: BigInt) {
    blocks(first: 1 where: { number: $blockNumber }) {
      timestamp
      number
    }
  }
  `;

  return getBlockDataFromQuery(query, { blockNumber });
}

async function getBlockDataFromQuery(
  query: string,
  variables: Record<string, any>,
): Promise<LatestBlockNumberAndTimestamp> {
  const result: any = await axios.post(
    subgraphUrl,
    {
      query,
      variables,
    },
    defaultAxiosConfig,
  )
    .then(response => response.data)
    .then(json => json as GraphqlDepositsResult);

  if (result.errors && typeof result.errors === 'object') {
    return Promise.reject(result.errors[0]);
  }
  if (result.data.blocks.length === 0) {
    return Promise.reject(new Error('No blocks found'));
  }

  return {
    blockNumber: parseInt(result.data.blocks[0].number, 10),
    timestamp: parseInt(result.data.blocks[0].timestamp, 10),
  };
}
