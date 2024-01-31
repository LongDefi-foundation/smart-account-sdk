import { ec as EC } from "elliptic";
import {
  encodeAbiParameters,
  encodeFunctionData,
  zeroAddress,
  type PublicClient,
  type TypedDataDefinition,
} from "viem";
import { decodeErrorResult, publicKeyToAddress } from "viem/utils";
import {
  AUTHORIZER_ABI,
  ENTRYPOINT_ABI,
  ERC20_ABI,
  SMART_ACCOUNT_V1_ABI,
  SMART_ACCOUNT_V1_FACTORY_ABI,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_SWAP_ROUTER_ABI,
} from "./abi";
import {
  DEX_CHAINS,
  ENTRYPOINT_ADDRESS,
  SMART_ACCOUNT_V1_CHAINS,
} from "./addresses";
import type { Dex } from "./types/dex";
import type {
  CreateSessionKeyRequestOutput,
  CreateSwapRequestInput,
  CreateSwapRequestOutput,
  UserOperation,
} from "./types/smartAccountV1";

export class SmartAccountV1Provider {
  readonly ecdsa = new EC("secp256k1");
  publicClient: PublicClient;
  authorizer?: `0x${string}`;
  factory?: `0x${string}`;
  dex?: Dex;

  constructor(
    publicClient: PublicClient,
    authorizer?: `0x${string}`,
    factory?: `0x${string}`,
    dex?: Dex
  ) {
    this.publicClient = publicClient;

    const dexChain = publicClient.chain && DEX_CHAINS[publicClient.chain.id];
    this.dex = dex || dexChain;

    const smartAccountChain =
      publicClient.chain && SMART_ACCOUNT_V1_CHAINS[publicClient.chain.id];
    this.authorizer =
      authorizer || (smartAccountChain && smartAccountChain.authorizer);
    this.factory =
      factory || (smartAccountChain && smartAccountChain.smartAccountFactoryV1);
  }

  setDex(dex: Dex) {
    this.dex = dex;
  }

  setAuthorizer(authorizer: `0x${string}`) {
    this.authorizer = authorizer;
  }

  setFactory(factory: `0x${string}`) {
    this.factory = factory;
  }

  async createSessionKeyRequest(
    smartAccount: `0x${string}`,
    sessionNonce: bigint
  ): Promise<CreateSessionKeyRequestOutput> {
    if (!this.authorizer) {
      throw new Error("Must provider authorizer contract");
    }

    const sessionKeyPair = this.ecdsa.genKeyPair();
    const sessionAddress = publicKeyToAddress(
      `0x${sessionKeyPair.getPublic("hex")}`
    );

    // [fields, name, version, chainId, verifyingContract, salt, extensions]
    const [_fields, name, version, chainId, verifyingContract] =
      await this.publicClient.readContract({
        abi: AUTHORIZER_ABI,
        address: this.authorizer,
        functionName: "eip712Domain",
      });

    // The named list of all type definitions
    const types = {
      Permit: [
        {
          name: "smartAccount",
          type: "address",
        },
        {
          name: "sessionAddress",
          type: "address",
        },
        {
          name: "sessionNonce",
          type: "uint256",
        },
      ],
    } as const;

    const request: TypedDataDefinition = {
      domain: {
        name,
        version,
        chainId: Number(chainId),
        verifyingContract,
      },
      types,
      primaryType: "Permit",
      message: {
        smartAccount,
        sessionAddress,
        sessionNonce,
      },
    } as const;

    return {
      session: {
        privateKey: `0x${sessionKeyPair.getPrivate("hex")}`,
        address: sessionAddress,
      },
      request,
    };
  }

  aggregateClientSignatures(
    ownerSignature: `0x${string}`,
    sessionSignature: `0x${string}`,
    sessionNonce: bigint
  ): `0x${string}` {
    const ownerSig = ownerSignature.slice(2);
    const sessionSig = sessionSignature.slice(2);
    const nonce = encodeAbiParameters(
      [
        {
          type: "uint256",
        },
      ],
      [sessionNonce]
    ).slice(2);

    return `0x${ownerSig + sessionSig + nonce}`;
  }

  async createSwapRequest(
    createSwapRequestInput: CreateSwapRequestInput
  ): Promise<CreateSwapRequestOutput> {
    if (!this.dex) {
      throw new Error("Must provide dex contracts");
    }
    if (!this.factory) {
      throw new Error("Must provide smartAccountV1Factory contract");
    }

    if (
      !createSwapRequestInput.smartAccount &&
      !createSwapRequestInput.initSmartAccountInput
    ) {
      throw new Error(
        "Must provide either `smartAccount` or `initSmartAccountInput`"
      );
    }

    const weth = this.dex.weth;
    const dexName = createSwapRequestInput.dex;
    const dex = this.dex[dexName];
    if (!dex) {
      throw new Error(`${dexName} not supported`);
    }

    let smartAccount = createSwapRequestInput.smartAccount;
    let initCode = "0x" as `0x${string}`;

    const initSmartAccountInput = createSwapRequestInput.initSmartAccountInput;
    if (initSmartAccountInput) {
      const { owner, salt } = initSmartAccountInput;
      const address = await this.getSmartAccountAddress(owner, salt);
      const bytecode = await this.publicClient.getBytecode({ address });
      if (bytecode && bytecode !== "0x") {
        throw new Error("Smart account already exists");
      }

      const initCodeCallData = encodeFunctionData({
        abi: SMART_ACCOUNT_V1_FACTORY_ABI,
        functionName: "createAccount",
        args: [owner, salt],
      });

      initCode = (this.factory.toLowerCase() +
        initCodeCallData.slice(2)) as `0x${string}`;
      smartAccount = address.toLowerCase() as `0x${string}`;
    }
    if (!smartAccount) {
      throw new Error("Smart account not found");
    }

    const {
      tokenIn,
      tokenOut,
      fee,
      recipient,
      deadline,
      amountIn,
      amountOutMinimum,
    } = createSwapRequestInput.swapInput;
    if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      throw new Error("TokenIn and TokenOut must be different");
    }

    let swapRouterCalldata: `0x${string}`;
    if (tokenOut.toLowerCase() == weth.toLowerCase()) {
      const exactInputSingleCallData = encodeFunctionData({
        abi: UNISWAP_V3_SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            fee,
            recipient: zeroAddress,
            deadline,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96: BigInt(0),
          },
        ],
      });
      const unwrapWeth9CallData = encodeFunctionData({
        abi: UNISWAP_V3_SWAP_ROUTER_ABI,
        functionName: "unwrapWETH9",
        args: [amountOutMinimum, recipient || smartAccount],
      });

      const multicallCallData = encodeFunctionData({
        abi: UNISWAP_V3_SWAP_ROUTER_ABI,
        functionName: "multicall",
        args: [[exactInputSingleCallData, unwrapWeth9CallData]],
      });

      swapRouterCalldata = multicallCallData;
    } else {
      const exactInputSingleCallData = encodeFunctionData({
        abi: UNISWAP_V3_SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            fee,
            recipient: recipient || smartAccount,
            deadline,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96: BigInt(0),
          },
        ],
      });

      swapRouterCalldata = exactInputSingleCallData;
    }

    const dest: `0x${string}`[] = [];
    const value: bigint[] = [];
    const func: `0x${string}`[] = [];
    if (tokenIn.toLowerCase() === weth.toLowerCase()) {
      dest.push(dex.swapRouter);
      value.push(amountIn);
      func.push(swapRouterCalldata);
    } else {
      const approveCallData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [dex.swapRouter, amountIn],
      });

      dest.push(tokenIn, dex.swapRouter);
      func.push(approveCallData, swapRouterCalldata);
    }

    const executeBatchCallData = encodeFunctionData({
      abi: SMART_ACCOUNT_V1_ABI,
      functionName: "executeBatch",
      args: [dest, value, func],
    });

    // nonce is uint256 with 192-bit key and 64-bit value
    // key is pool address
    const suffixId = createSwapRequestInput.orderSeparatorId || 0;
    const nonce = await this.getNonceForSmartAccount(
      smartAccount,
      dex.factory,
      tokenIn,
      tokenOut,
      fee,
      suffixId
    );

    const userOpWithoutSign: UserOperation = {
      sender: smartAccount,
      nonce,
      initCode,
      callData: executeBatchCallData,
      callGasLimit: 0n,
      verificationGasLimit: 0n,
      preVerificationGas: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      paymasterAndData: "0x" as `0x${string}`,
      signature: "0x" as `0x${string}`,
    };

    // ==================================================
    // ===== maximum of values before is "< uin120" =====
    // ==================================================
    // Note: Step 1 -> 3 is gasLimit, 4 is gasPrice
    // So, (1 + 2 + 3) * 4 = total `wei` needs to execute this transaction

    // 1. calculate callGasLimit => Gas limit for execution phase, estimate by using EntryPoint simulation (function simulateValidation)
    userOpWithoutSign.callGasLimit = await this.calculateExecuteBatchGasLimit(
      smartAccount,
      dest,
      value,
      func
    );

    // 2. calculate verificationGasLimit => Gas limit for verification phase, estimate by using EntryPoint simulation (function simulateValidation)
    userOpWithoutSign.verificationGasLimit =
      await this.calculateVerificationGasLimitV1(userOpWithoutSign);

    // 3. calculate preVerificationGas => Gas to compensate the bundler, Use internal bundler => Don't care
    // userOpWithoutSign.preVerificationGas = BigInt(0);

    // 4. calculate maxFeePerGas => avg 30 gwei
    // 5. calculate maxPriorityFeePerGas => avg 2 gwei
    // TODO: Both fees based on particular chain

    if (!createSwapRequestInput.gasless) {
      userOpWithoutSign.maxFeePerGas = BigInt(30e9);
      userOpWithoutSign.maxPriorityFeePerGas = BigInt(2e9);
    }

    // userOpHash does not depend on signature
    const userOpHash = await this.publicClient.readContract({
      abi: ENTRYPOINT_ABI,
      address: ENTRYPOINT_ADDRESS,
      functionName: "getUserOpHash",
      args: [userOpWithoutSign],
    });

    return { smartAccount, userOpHash, request: userOpWithoutSign };
  }

  async getSmartAccountAddress(owner: `0x${string}`, salt: bigint) {
    if (!this.factory) {
      throw new Error("Factory not supported");
    }

    const address = await this.publicClient.readContract({
      abi: SMART_ACCOUNT_V1_FACTORY_ABI,
      address: this.factory,
      functionName: "getAddress",
      args: [owner, salt],
    });

    return address;
  }

  async getNonceForSmartAccount(
    smartAccount: `0x${string}`,
    dexFactory: `0x${string}`,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    fee: number,
    suffixId: number
  ): Promise<bigint> {
    const poolAddr = await this.publicClient.readContract({
      abi: UNISWAP_V3_FACTORY_ABI,
      address: dexFactory,
      functionName: "getPool",
      args: [tokenIn, tokenOut, fee],
    });

    // key of nonce is 192-bit
    const formattedPoolAddr = poolAddr.toLowerCase(); // 20-byte = 160-bit
    const keyPrefix = BigInt(formattedPoolAddr) << BigInt(32);

    if (!(suffixId < 2 ** 31)) {
      throw new Error("Suffix id must be less than 2^31");
    }
    const zeroForOne = tokenIn.toLowerCase() < tokenOut.toLowerCase() ? 1n : 0n;
    const keySuffix = (zeroForOne << 31n) | BigInt(suffixId);
    const key = keyPrefix | keySuffix;

    const nonce = await this.publicClient.readContract({
      abi: ENTRYPOINT_ABI,
      address: ENTRYPOINT_ADDRESS,
      functionName: "getNonce",
      args: [smartAccount, key],
    });

    return nonce;
  }

  async calculateVerificationGasLimitV1(
    userOp: UserOperation
  ): Promise<bigint> {
    const maxGas = 30_000_000n;
    const mockSignature =
      "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c";
    const authorizerSignature = mockSignature.slice(2);
    const ownerSignature = mockSignature.slice(2);
    const sessionSignature = mockSignature.slice(2);
    const nonce = "".padEnd(64, "0");
    const data = encodeFunctionData({
      abi: ENTRYPOINT_ABI,
      functionName: "simulateValidation",
      args: [
        {
          ...userOp,
          verificationGasLimit: maxGas,
          signature: `0x${
            authorizerSignature + ownerSignature + sessionSignature + nonce
          }`,
        },
      ],
    });
    const rpcUrl = this.publicClient.transport.url;
    if (!rpcUrl) {
      throw new Error("RPC URL not found");
    }
    const simulationRes = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [
          {
            from: ENTRYPOINT_ADDRESS,
            to: ENTRYPOINT_ADDRESS,
            data,
          },
          "pending",
        ],
        id: 1,
      }),
    });
    const encodedData = await simulationRes.json();
    const result = decodeErrorResult({
      abi: ENTRYPOINT_ABI,
      data: encodedData.error.data,
    });
    if (result.errorName === "ValidationResult") {
      const returnInfo = result.args[0];
      const { preOpGas } = returnInfo;
      return preOpGas;
    }

    throw new Error(
      `Estimate verification gas: ${result.errorName}(${result.args})`
    );
  }

  async calculateExecuteBatchGasLimit(
    smartAccount: `0x${string}`,
    dest: `0x${string}`[],
    value: bigint[],
    func: `0x${string}`[]
  ): Promise<bigint> {
    try {
      const estimatedGas = await this.publicClient.estimateContractGas({
        abi: SMART_ACCOUNT_V1_ABI,
        address: smartAccount,
        functionName: "executeBatch",
        args: [dest, value, func],
        account: ENTRYPOINT_ADDRESS,
      });

      // ref: https://github.com/wolflo/evm-opcodes/blob/main/gas.md#aa-call-operations
      const baseGas = BigInt(21_000);

      // smart account does not exist, so can not estimate gas
      if (estimatedGas <= 50_000) {
        return BigInt(200_000);
      }
      return estimatedGas - baseGas;
    } catch (error) {
      // Error when smart account:
      // +) not have enough balance to simulate
      // +) not reach `amountOutMin`
      return BigInt(200_000);
    }
  }
}
