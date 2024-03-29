import type { TypedDataDefinition } from "viem";
import type { DexName, SinglePathSwapInput } from "./dex";

export type SmartAccountV1Addresses = {
  authorizer: `0x${string}`;
  entrypoint: `0x${string}`;
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
  orderSeparatorId?: number; // default 0
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

export type CreateSessionKeyRequestOutput = {
  session: {
    privateKey: `0x${string}`;
    address: `0x${string}`;
  };
  request: TypedDataDefinition;
};
