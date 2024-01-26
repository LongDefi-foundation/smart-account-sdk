import type { DexName, SinglePathSwapInput } from "./dex";

export type SmartAccountV1Addresses = {
  entrypoint: `0x${string}`;
  sessionKeyManager: `0x${string}`;
  smartAccountFactoryV1: `0x${string}`;
};

export type SmartAccountV1Chains = {
  [chainId: number]: SmartAccountV1Addresses;
};

export type UserOperation = {
  sender: `0x${string}`;
  nonce: bigint;
  initCode: `0x${string}`;
  callData: `0x${string}`;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: `0x${string}`;
  signature: `0x${string}`;
};

export type InitSmartAccountV1Input = {
  owner: `0x${string}`;
  salt: bigint;
};

export type CreateSwapRequestInput = {
  orderId: number;
  smartAccount?: `0x${string}`;
  dex: DexName;
  swapInput: SinglePathSwapInput;
  gasless: boolean;
  initSmartAccountInput?: InitSmartAccountV1Input;
};

export type CreateSwapRequestOutput = {
  smartAccount: `0x${string}`;
  userOpHash: `0x${string}`;
  request: UserOperation;
};
