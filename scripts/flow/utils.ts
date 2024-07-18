export function requireIsArbitrumNetwork() {
  if (process.env.NETWORK_ID !== '42161') {
    throw new Error('Invalid network ID, expected 42161 (Arbitrum)!');
  }
}
