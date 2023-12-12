// declare global env variable to define types
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      ACCOUNT_POLL_INTERVAL_MS
      ACCOUNT_WALLET_ADDRESS
      ACCOUNT_WALLET_PRIVATE_KEY
      DETONATIONS_ENABLED
      ETHEREUM_NODE_URL
      GAS_PRICE_ADDITION
      GAS_PRICE_MULTIPLIER
      GAS_PRICE_POLL_INTERVAL_MS
      INITIAL_GAS_PRICE_WEI
      LEVEL_REQUESTS_ENABLED
      NETWORK_ID
      LEVEL_REQUESTS_POLL_INTERVAL_MS
      SUBGRAPH_URL
    }
  }
}

export { };
