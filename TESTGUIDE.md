# Testing Guide

- This guide is for testing contracts on local environment.

## Prerequisite

- Installed `Foundry`. [installation](https://book.getfoundry.sh/getting-started/installation)
- (Optional) Installed `bun`. ([installation](https://bun.sh/docs/installation))

1. Clone contract repo and install dependencies

```sh
$ git clone git@github.com:LongDefi-foundation/core-contracts.git
$ cd core-contracts

$ forge install
$ bun install # yarn
```

2. Create `.env` in `core-contracts` repo

```ts
export API_KEY_INFURA="<API_KEY>"
export FOUNDRY_PROFILE="default"
```

3. Run anvil fork in `core-contracts` repo

```sh
$ source .env
$ anvil --fork-url https://sepolia.infura.io/v3/$API_KEY_INFURA --fork-block-number 5176224
```
