export enum ChainId {
  ArbitrumOne = 42161,
  Base = 8453,
  Berachain = 80084,
  Mantle = 5000,
  PolygonZkEvm = 1101,
  XLayer = 196,
}

export function isArbitrum(chainId: ChainId): boolean {
  return chainId === ChainId.ArbitrumOne;
}

export function isBase(chainId: ChainId): boolean {
  return chainId === ChainId.Base;
}

export function isMantle(chainId: ChainId): boolean {
  return chainId === ChainId.Mantle;
}

export function isPolygon(chainId: ChainId): boolean {
  return chainId === ChainId.PolygonZkEvm;
}

export function isXLayer(chainId: ChainId): boolean {
  return chainId === ChainId.XLayer;
}
