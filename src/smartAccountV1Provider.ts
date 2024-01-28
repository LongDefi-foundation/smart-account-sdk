import { ec as EC } from "elliptic";
import {
  encodeFunctionData,
  keccak256,
  type Chain,
  type PublicClient,
  type Transport,
  type TypedDataDefinition,
} from "viem";
import {
  ENTRYPOINT_ABI,
  ERC20_ABI,
  SESSION_KEY_MANAGER_ABI,
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
  CreateSwapRequestInput,
  CreateSwapRequestOutput,
  UserOperation,
} from "./types/smartAccountV1";

export class SmartAccountV1Provider {
  readonly SESSION_MANAGER_DOMAIN_NAME = "LongDefi Session Key Manager";
  readonly ecdsa = new EC("secp256k1");
  publicClient: PublicClient<Transport, Chain>;
  dex?: Dex;
  factory?: `0x${string}`;
  sessionKeyManager?: `0x${string}`;

  constructor(
    publicClient: PublicClient<Transport, Chain>,
    factory?: `0x${string}`,
    sessionKeyManager?: `0x${string}`,
    dex?: Dex
  ) {
    const dexChain = DEX_CHAINS[publicClient.chain.id];
    const smartAccountChain = SMART_ACCOUNT_V1_CHAINS[publicClient.chain.id];

    this.publicClient = publicClient;
    this.dex = dex || dexChain;
    this.factory =
      factory || (smartAccountChain && smartAccountChain.smartAccountFactoryV1);
    this.sessionKeyManager =
      sessionKeyManager ||
      (smartAccountChain && smartAccountChain.sessionKeyManager);
  }

  setDex(dex: Dex) {
    this.dex = dex;
  }

  setFactory(factory: `0x${string}`) {
    this.factory = factory;
  }

  setSessionKeyManager(sessionKeyManager: `0x${string}`) {
    this.sessionKeyManager = sessionKeyManager;
  }

  async createSessionKeyRequest(
    owner: `0x${string}`,
    smartAccountSalt: bigint
  ) {
    if (!this.sessionKeyManager) {
      throw new Error("Session key manager not supported on this chain");
    }

    const sessionKeyPair = this.ecdsa.genKeyPair();
    const publicKey = sessionKeyPair.getPublic("hex");
    const kc = keccak256(`0x${publicKey}`).slice(2);
    const sessionKeyAddress = `0x${kc.slice(-40)}` as const;

    // All properties on a domain are optional
    const domain = {
      name: this.SESSION_MANAGER_DOMAIN_NAME,
      version: "1",
      chainId: this.publicClient.chain.id,
      verifyingContract: this.sessionKeyManager,
    } as const;

    // The named list of all type definitions
    const types = {
      Permit: [
        {
          name: "owner",
          type: "address",
        },
        {
          name: "salt",
          type: "uint256",
        },
        {
          name: "sessionKey",
          type: "address",
        },
        {
          name: "nonce",
          type: "uint256",
        },
      ],
    } as const;

    // check if session key is already authorized
    const isAuthorized = await this.publicClient.readContract({
      abi: SESSION_KEY_MANAGER_ABI,
      address: this.sessionKeyManager,
      functionName: "isAuthorized",
      args: [owner, sessionKeyAddress],
    });

    if (isAuthorized) {
      throw new Error("Session key already authorized");
    }

    // get nonce from SessionManagerContract
    const nonce = await this.publicClient.readContract({
      abi: SESSION_KEY_MANAGER_ABI,
      address: this.sessionKeyManager,
      functionName: "nonces",
      args: [owner],
    });

    const request: TypedDataDefinition = {
      domain,
      types,
      primaryType: "Permit",
      message: {
        owner,
        salt: smartAccountSalt,
        sessionKey: sessionKeyAddress,
        nonce,
      },
    } as const;

    return {
      sessionKey: {
        privateKey: sessionKeyPair.getPrivate("hex"),
        address: sessionKeyAddress,
      },
      request,
    };
  }

  async revokeSessionKeyRequest(
    owner: `0x${string}`,
    smartAccountSalt: bigint,
    pub:
      | Uint8Array
      | Buffer
      | string
      | number[]
      | { x: string; y: string }
      | EC.KeyPair,
    enc?: string
  ): Promise<TypedDataDefinition> {
    if (!this.sessionKeyManager) {
      throw new Error("Session key manager not supported on this chain");
    }

    const key = this.ecdsa.keyFromPublic(pub, enc);
    const publicKey = key.getPublic("hex");
    const kc = keccak256(`0x${publicKey}`).slice(2);
    const sessionKey = `0x${kc.slice(-40)}` as const;

    // All properties on a domain are optional
    const domain = {
      name: this.SESSION_MANAGER_DOMAIN_NAME,
      version: "1",
      chainId: this.publicClient.chain.id,
      verifyingContract: this.sessionKeyManager,
    } as const;

    // The named list of all type definitions
    const types = {
      Revoke: [
        {
          name: "owner",
          type: "address",
        },
        {
          name: "salt",
          type: "uint256",
        },
        {
          name: "sessionKey",
          type: "address",
        },
        {
          name: "nonce",
          type: "uint256",
        },
      ],
    } as const;

    // check if session key is already authorized
    const isAuthorized = await this.publicClient.readContract({
      abi: SESSION_KEY_MANAGER_ABI,
      address: this.sessionKeyManager,
      functionName: "isAuthorized",
      args: [owner, sessionKey],
    });

    if (isAuthorized) {
      throw new Error("Session key already authorized");
    }

    // get nonce from SessionManagerContract
    const nonce = await this.publicClient.readContract({
      abi: SESSION_KEY_MANAGER_ABI,
      address: this.sessionKeyManager,
      functionName: "nonces",
      args: [owner],
    });

    const request: TypedDataDefinition = {
      domain,
      types,
      primaryType: "Revoke",
      message: {
        owner,
        salt: smartAccountSalt,
        sessionKey,
        nonce,
      },
    };

    return request;
  }

  async createSwapRequest(
    createSwapRequestInput: CreateSwapRequestInput
  ): Promise<CreateSwapRequestOutput> {
    if (
      !createSwapRequestInput.smartAccount &&
      !createSwapRequestInput.initSmartAccountInput
    ) {
      throw new Error(
        "Must provide either `smartAccount` or `initSmartAccountInput`"
      );
    }
    if (!this.dex) {
      throw new Error("Dex not supported");
    }
    if (!this.factory) {
      throw new Error("Factory not supported");
    }

    const dexName = createSwapRequestInput.dex;
    const dex = this.dex[dexName];
    if (!dex) {
      throw new Error(`${dexName} not supported`);
    }

    let smartAccount = createSwapRequestInput.smartAccount;
    let initCode = "0x" as `0x${string}`;

    const smartAccountFactory = this.factory;

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

      initCode = (smartAccountFactory.toLowerCase() +
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
      sqrtPriceLimitX96,
    } = createSwapRequestInput.swapInput;
    const approveCallData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [dex.swapRouter, amountIn],
    });

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
          sqrtPriceLimitX96: sqrtPriceLimitX96 || BigInt(0),
        },
      ],
    });
    const dest = [tokenIn, dex.swapRouter];
    const value: bigint[] = [];
    const func = [approveCallData, exactInputSingleCallData];

    const executeBatchCallData = encodeFunctionData({
      abi: SMART_ACCOUNT_V1_ABI,
      functionName: "executeBatch",
      args: [dest, value, func],
    });

    // nonce is uint256 with 192-bit key and 64-bit value
    // key is pool address
    const suffixId = createSwapRequestInput.orderId;
    const nonce = await this.getNonceForSmartAccount(
      smartAccount,
      dex.factory,
      tokenIn,
      tokenOut,
      fee,
      suffixId
    );

    // ==================================================
    // ===== maximum of values before is "< uin120" =====
    // ==================================================
    // Note: Step 1 -> 3 is gasLimit, 4 is gasPrice
    // So, (1 + 2 + 3) * 4 = total `wei` needs to execute this transaction

    // 1. calculate callGasLimit => Gas limit for execution phase, estimate by using EntryPoint simulation (function simulateValidation)
    const callGasLimit = await this.calculateExecuteBatchGasLimit(
      smartAccount,
      dest,
      value,
      func
    );

    // 2. calculate verificationGasLimit => Gas limit for verification phase, estimate by using EntryPoint simulation (function simulateValidation)
    const verificationGasLimit = await this.calculateVerificationGasLimitV1(
      initCode !== "0x"
    );

    // 3. calculate preVerificationGas => Gas to compensate the bundler, Use internal bundler => Don't care
    const preVerificationGas = BigInt(0);

    // 4. calculate maxFeePerGas => avg 30 gwei
    // 5. calculate maxPriorityFeePerGas => avg 2 gwei
    // TODO: Both fees based on particular chain

    let maxFeePerGas = BigInt(0);
    let maxPriorityFeePerGas = BigInt(0);

    if (!createSwapRequestInput.gasless) {
      maxFeePerGas = BigInt(30e9);
      maxPriorityFeePerGas = BigInt(2e9);
    }

    const userOpWithoutSign: UserOperation = {
      sender: smartAccount,
      nonce,
      initCode,
      callData: executeBatchCallData,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymasterAndData: "0x" as `0x${string}`,
      signature: "0x" as `0x${string}`,
    };

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
    initSmartAccount?: boolean
  ): Promise<bigint> {
    if (initSmartAccount) {
      return BigInt(300_000);
    } else {
      return BigInt(60_000);
    }
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

      // TODO: smart account does not exist, so can not estimate gas
      if (estimatedGas < 30_000) {
        return BigInt(500_000);
      }
      return estimatedGas - baseGas;
    } catch (error) {
      // Error when smart account does not have enough balance to simulate
      return BigInt(200_000);
    }
  }
}
