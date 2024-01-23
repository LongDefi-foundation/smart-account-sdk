# LongDefi Smart Account Sdk

## Installation

```bash
npm install @long-defi/smart-account-sdk viem
```

## Usage

### `SmartAccountV1Provider` instance:

```typescript
import { SmartAccountV1Provider } from "@longdefi/smart-account-sdk";

const smartAccountV1Provider = new SmartAccountV1Provider(publicClient);
```

### Create Session Key

```typescript
const { sessionKey, request } =
  await smartAccountProvider.createSessionKeyRequest(
    account.address,
    smartAccountSalt
  );

// Using `wagmi` to sign request (ref: https://wagmi.sh/core/api/actions/signTypedData)
const signature = await signMessage(config, request);
```

### Swap request with **new** wallet

```typescript
const smartAccountSalt = BigInt(0);
const initSmartAccountInput = {
  owner: ownerSmartAccount.account.address,
  salt: smartAccountSalt,
};
const singlePathSwapInput = {
  tokenIn: token1Address,
  tokenOut: token0Address,
  fee: 3000,
  deadline: BigInt(2 ** 255),
  amountIn: BigInt(10 ** 6),
  amountOutMinimum: BigInt(0),
  sqrtPriceLimitX96: BigInt(0),
} as const;

const { smartAccount, userOpHash, request } =
  await smartAccountV1Provider.createSwapRequest({
    dex: "uniswapV3",
    swapInput: singlePathSwapInput,
    gasless: true,
    initSmartAccountInput,
  });

// Using `wagmi` to sign request
const signature = await signMessage(config, {
  message: { raw: userOpHash },
});

const userOperation = { ...request, signature };
```

### Swap request with **existed** wallet

```typescript
const singlePathSwapInput = {
  tokenIn: token1Address,
  tokenOut: token0Address,
  fee: 3000,
  deadline: BigInt(2 ** 255),
  amountIn: BigInt(20),
  amountOutMinimum: BigInt(0),
  sqrtPriceLimitX96: BigInt(0),
};
const gasless = true;
const { userOpHash, request } = await smartAccountV1Provider.createSwapRequest({
  smartAccount: smartAccountV1.address,
  dex: "uniswapV3",
  swapInput: singlePathSwapInput,
  gasless,
});

// Using `wagmi` to sign request
const signature = await signMessage(config, {
  message: { raw: userOpHash },
});

const userOperation = { ...request, signature };
```

### Price Utils

```typescript
const publicClient = createPublicClient({ chain: mainnet, transport: http() });

// The order of tokens is not important
const price = await convertSqrtX96toPrice(
  publicClient,
  [token0, token1],
  sqrtPriceX96
);

const sqrtX96 = await convertPriceToSqrtX96(
  publicClient,
  [token0, token1],
  price
);
```

## Supported Chains

- Mumbai
