# LongDefi Smart Account Sdk

## Installation

```bash
npm install @long-defi/sdk viem
```

## Supported Chains

- Sepolia

## Usage

### Exampe

- https://github.com/LongDefi-foundation/sdk-example

### Create `SmartAccountV1Provider` instance:

```typescript
import { SmartAccountV1Provider } from "@long-defi/sdk";

const smartAccountV1Provider = new SmartAccountV1Provider(publicClient);
```

### Create Session Key

```typescript
/**
 *  type CreateSessionKeyRequestOutput = {
 *    session: {
 *      privateKey: `0x${string}`;
 *      address: `0x${string}`;
 *    };
 *    request: TypedDataDefinition;
 *  }
 */

const data: CreateSessionKeyRequestOutput =
  await smartAccountProvider.createSessionKeyRequest(
    smartAccount,
    sessionNonce
  );

// Signing with `useSignTypedData()` hook (https://wagmi.sh/react/api/hooks/useSignTypedData)
const signature = await signTypedDataAsync(data.request);
```

### Create swap request with session key

```typescript
// Prerequisite: Smart account already deployed
const smartAccountSalt = BigInt(0);
const smartAccount = await getSmartAccountAddress(owner.address, smartAccountSalt);

// 1. Create session key and sign session key request
const sessionNonce: bigint = ...; // challenge from server
const { session, request } = await smartAccountV1Provider.createSessionKeyRequest(
  smartAccount,
  sessionNonce
);
const ownerSignature = await owner.signTypedData(sessionRequest);

// 2. Create swap request and sign with session key
const singlePathSwapInput = {
  tokenIn,
  tokenOut,
  fee: 3000,
  deadline: BigInt(2 ** 255),
  amountIn: BigInt(20),
  amountOutMinimum: BigInt(0),
};
// using when creating multiple orders in one direction(buy/sell) within a single pool.
const orderSeparatorId = 0;
const { userOpHash, request } = await smartAccountV1Provider.createSwapRequest({
  orderSeparatorId, // optional, default is 0
  smartAccount,
  dex: "uniswapV3",
  swapInput: singlePathSwapInput,
  gasless: true,
});
const sessionSignature = signMessage({
  privateKey: session.privateKey,
  message: { raw: message },
});

// 3. Aggregate signatures
const clientSignature = smartAccountV1Provider.aggregateClientSignatures(
  ownerSignature,
  sessionSignature,
  sessionNonce
);
const userOperation = { ...request, signature: clientSignature };

// ==========================================
// ===== Send `userOperation` to server =====
// ==========================================
const serverSignature = await bundler.signMessage({
  message: { raw: userOpHash },
});
const fullSignature = `0x${
  serverSignature.slice(2) + clientSignatures.slice(2)
}` as const;
userOperation.signature = signafullSignatureture;
```

### Create swap request without session key

```typescript
const singlePathSwapInput = {
  tokenIn,
  tokenOut,
  fee: 3000,
  deadline: BigInt(2 ** 255),
  amountIn: BigInt(100),
  amountOutMinimum: BigInt(0),
  recipient: smartAccount, // optional, default is smart account
} as const;

// using when creating multiple orders in one direction(buy/sell) within a single pool.
const orderSeparatorId = 0;
const { smartAccount, userOpHash, request } =
  await smartAccountV1Provider.createSwapRequest({
    orderSeparatorId, // optional, default is 0
    smartAccount,
    dex: "uniswapV3",
    swapInput: singlePathSwapInput,
    gasless: true,
  });

const signature = await signMessage(config, {
  message: { raw: userOpHash },
});

const userOperation = { ...request, signature };
```

### Price Utils

```typescript
const publicClient = usePublicClient();

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
