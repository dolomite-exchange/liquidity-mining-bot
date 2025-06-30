import fs from 'fs';
import path from 'path';
import { ChainId } from './chain-id';
import Logger from './logger';

const NETWORK_TO_ENV_FILE_MAP: Record<ChainId, string> = {
  [ChainId.ArbitrumOne]: path.resolve(process.cwd(), 'detonator.arbitrum-one.production.env'),
  [ChainId.Base]: path.resolve(process.cwd(), 'detonator.base.production.env'),
  [ChainId.Berachain]: path.resolve(process.cwd(), 'detonator.berachain.production.env'),
  [ChainId.Botanix]: path.resolve(process.cwd(), 'detonator.botanix.production.env'),
  [ChainId.Ethereum]: path.resolve(process.cwd(), 'detonator.ethereum.production.env'),
  [ChainId.Mantle]: path.resolve(process.cwd(), 'detonator.mantle.production.env'),
  [ChainId.PolygonZkEvm]: path.resolve(process.cwd(), 'detonator.polygon-zkevm.production.env'),
  [ChainId.XLayer]: path.resolve(process.cwd(), 'detonator.x-layer.production.env'),
}

const ENV_FILENAME = process.env.ENV_FILENAME;
const NETWORK = process.env.NETWORK_ID ?? '';

if (!NETWORK && !ENV_FILENAME) {
  throw new Error('No NETWORK_ID or ENV_FILENAME specified!');
}

if (ENV_FILENAME || (NETWORK_TO_ENV_FILE_MAP[NETWORK] && fs.existsSync(NETWORK_TO_ENV_FILE_MAP[NETWORK]))) {
  // eslint-disable-next-line
  require('dotenv').config({ path: [ENV_FILENAME ?? NETWORK_TO_ENV_FILE_MAP[NETWORK], '.env'] });
} else {
  Logger.info({
    message: 'No ENV_FILENAME specified, using default env variables passed through the environment.',
  });
  // eslint-disable-next-line
  require('dotenv').config();
}

export function isScript() {
  return process.env.SCRIPT === 'true';
}

export function shouldForceUpload() {
  return process.env.FORCE_UPLOAD === 'true';
}
