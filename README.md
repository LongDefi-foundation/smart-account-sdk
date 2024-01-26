# LongDefi Smart Account Sdk

## Installation

```bash
npm install @long-defi/sdk viem
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

// Signing with `useSignTypedData()` hook (https://wagmi.sh/react/api/hooks/useSignTypedData)
const signature = await signTypedDataAsync(request);
```

### Create swap request with uninitialized wallet

```typescript
// Get smart account salt from server
const smartAccountSalt = await getSmartAccountSaltFromServer(...args);

const smartAccount = await smartAccountProvider.getSmartAccountAddress(
  owner,
  smartAccountSalt
);
const initSmartAccountInput = {
  owner,
  salt: smartAccountSalt,
};
const singlePathSwapInput = {
  tokenIn,
  tokenOut,
  fee: 3000,
  deadline: BigInt(2 ** 255),
  amountIn: BigInt(100),
  amountOutMinimum: BigInt(0),
  sqrtPriceLimitX96: BigInt(0), // optional, default is 0
  recipient: smartAccount, // optional, default is smart account
} as const;

// Get orderId from server, must be unique
const orderId = await getOrderIdFromServer(...args);

const { smartAccount, userOpHash, request } =
  await smartAccountV1Provider.createSwapRequest({
    dex: "uniswapV3",
    swapInput: singlePathSwapInput,
    gasless: true,
    initSmartAccountInput,
    orderId,
  });

// There are 2 ways to sign request
// 1. Using `useSignMessage` hook of `wagmi`
const signature = await signMessage(config, {
  message: { raw: userOpHash },
});
// 2. Using sessionKey
const signature = signMessageWithSessionKey(userOpHash);

const userOperation = { ...request, signature };
// Send `userOperation` to server
```

### Swap request with existed wallet

```typescript
const smartAccount = await smartAccountV1Provider.getSmartAccountAddress(
  owner,
  smartAccountSalt
);
const singlePathSwapInput = {
  tokenIn,
  tokenOut,
  fee: 3000,
  deadline: BigInt(2 ** 255),
  amountIn: BigInt(20),
  amountOutMinimum: BigInt(0),
  sqrtPriceLimitX96: BigInt(0),
};
const gasless = true;
const { userOpHash, request } = await smartAccountV1Provider.createSwapRequest({
  smartAccount,
  dex: "uniswapV3",
  swapInput: singlePathSwapInput,
  gasless,
});

// There are 2 ways to sign request
// 1. Using `useSignMessage` hook of `wagmi`
const signature = await signMessage(config, {
  message: { raw: userOpHash },
});
// 2. Using sessionKey
const signature = signMessageWithSessionKey(userOpHash);

const userOperation = { ...request, signature };
// Send `userOperation` to server
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
