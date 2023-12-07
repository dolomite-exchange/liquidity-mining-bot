<p style="text-align: center"><img src="https://github.com/dolomite-exchange/dolomite-margin/raw/master/docs/dolomite-logo.png" width="256" alt="Dolomite Logo" /></p>

<div style="text-align: center">
  <a href='https://hub.docker.com/r/dolomiteprotocol/liquidity-mining-bot' style="text-decoration:none;">
    <img src='https://img.shields.io/badge/docker-container-blue.svg?longCache=true' alt='Docker' />
  </a>
  <a href='https://github.com/dolomite-exchange/liquidity-mining-bot/blob/master/LICENSE' style="text-decoration:none;">
    <img src='https://img.shields.io/github/license/dolomite-exchange/liquidity-mining-bot.svg' alt='License' />
  </a>
  <a href='https://t.me/official' style="text-decoration:none;">
    <img src='https://img.shields.io/badge/chat-on%20telegram-9cf.svg?longCache=true' alt='Telegram' />
  </a>
</div>

# Liquidity mining Bot

Bot to automatically perform level update requests and perform oARB vesting detonations for Dolomite's liquidity mining
program.s

## Usage

### Docker

Requires a running [docker](https://docker.com) engine.

```
docker run \
  -e ACCOUNT_WALLET_ADDRESS=0x2c7536E3605D9C16a7a3D7b1898e529396a65c23 \
  -e ACCOUNT_WALLET_PRIVATE_KEY=0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318 \
  -e ETHEREUM_NODE_URL=https://matic-mumbai.chainstacklabs.com \
  -e NETWORK_ID=80001 \
  -e SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/dolomite-exchange/dolomite-v2-arbitrum \
  dolomiteprotocol/liquidity-mining
```

## Overview

This service will automatically fulfill level update requests, perform detonations, and more for Dolomite's liquidity
mining program.

## Configuration

### Environment Variables

| ENV Variable                | Description                                                                                                                                                                                                                               |
|-----------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ACCOUNT_POLL_INTERVAL_MS    | How frequently to poll for account positions that need detonation. Defaults to `15000` milliseconds.                                                                                                                                      |
| ACCOUNT_WALLET_ADDRESS      | **REQUIRED** Ethereum address of the Dolomite account owner that will do the liquidations.                                                                                                                                                |
| ACCOUNT_WALLET_PRIVATE_KEY  | **REQUIRED** Ethereum private key the Dolomite account owner that will do the liquidations. Make sure that "0x" is at the start of it (MetaMask exports private keys without it).                                                         |
| AUTO_DOWN_FREQUENCY_SECONDS | The duration in seconds after the bot starts that it should be automatically killed, so AWS (or whichever cloud provider being used) can restart the docker container. Useful in case the bot ever gets stuck. Defaults none `undefined`. |
| ETHEREUM_NODE_URL           | **REQUIRED** The URL of the Ethereum node to use (e.g. an [Alchemy](https://alchemy.com) or [Infura](https://infura.io/) endpoint).                                                                                                       |
| GAS_PRICE_MULTIPLIER        | How much to multiply the `fast` gas price by when sending transactions. Defaults to `1` but it is recommended users set this variable to something higher.                                                                                |
| GAS_PRICE_POLL_INTERVAL_MS  | How frequently to update the gas price. Defaults to `15000` milliseconds.                                                                                                                                                                 |
| INITIAL_GAS_PRICE_WEI       | The initial gas price used by the bot until the first successful poll occurs. Defaults to `10000000000` wei (10 gwei).                                                                                                                    |
| NETWORK_ID                  | **REQUIRED** Ethereum Network ID. This must match the chain ID sent back from `ETHEREUM_NODE_URL`.                                                                                                                                        |
| OWED_PREFERENCES            | **CONDITIONALLY REQUIRED** A list of preferences for which markets to liquidate first on an account when liquidating.  This variable is only required if `LIQUIDATION_MODE` is set to `Simple`.                                           |
| REQUEST_POLL_INTERVAL_MS    | How frequently to poll for level update requests. Defaults to `3000` milliseconds.                                                                                                                                                        |
| SUBGRAPH_URL                | **REQUIRED** The URL of the subgraph instance that contains margin account information. For Arbitrum One, the default URL is `https://api.thegraph.com/subgraphs/name/dolomite-exchange/dolomite-v2-arbitrum`                             |
