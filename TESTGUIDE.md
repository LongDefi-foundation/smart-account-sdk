# Testing Guide

- This guide is for testing contracts on local environment.

## Prerequisite

- Installed `Foundry`. [installation](https://book.getfoundry.sh/getting-started/installation)
- (Optional) Installed `anvil`. ([installation](https://bun.sh/docs/installation))

1. Clone contract repo and install dependencies

```sh
$ git clone git@github.com-ken-zokker:LongDefi-foundation/core-contracts.git
$ cd core-contracts

$ forge install
$ bun install # yarn
```

2. Run anvil fork

```sh
$ anvil --fork-url https://polygon-mainnet.infura.io/v3/$API_KEY_INFURA
```

3. Run setup script

```sh
$ forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --chain polygon --broadcast
```
