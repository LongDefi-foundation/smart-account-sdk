import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  hexToSignature,
  http,
  type HttpRequestErrorType,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { SmartAccountV1Provider } from ".";
import {
  ENTRYPOINT_ABI,
  ERC20_ABI,
  SESSION_KEY_MANAGER_ABI,
  SMART_ACCOUNT_V1_ABI,
  SMART_ACCOUNT_V1_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
} from "./abi";
import { ENTRYPOINT_ADDRESS } from "./addresses";

// WETH address: 0xD86bc69b52508368622E4F9f8f70a603FFbFC89C
// USDC address: 0xfE435387201D3327983d19293B60C1C014E61650
// Pool address: 0x346edF1FCc46581287513B4afe8F35a7fAB673C9
// SmartAccountV1Factory: 0x3AD4869afcC42f5Ad199914d398b3172c576f413
// SessionKeyManager: 0x97df52b63a4E506fB5d7E2bb231aF552c02b5fa1

const WETH_ADDRESS = "0xD86bc69b52508368622E4F9f8f70a603FFbFC89C";
const USDC_ADDRESS = "0xfE435387201D3327983d19293B60C1C014E61650";
const POOL_ADDRESS = "0x346edF1FCc46581287513B4afe8F35a7fAB673C9";
const SMART_ACCOUNT_V1_FACTORY_ADDRESS =
  "0x3AD4869afcC42f5Ad199914d398b3172c576f413";
const SESSION_KEY_MANAGER_ADDRESS =
  "0x97df52b63a4E506fB5d7E2bb231aF552c02b5fa1";

const url = "http://localhost:8545"; // anvil local node
// const testClient = createTestClient({
//   mode: "anvil",
//   chain: polygon,
//   transport: http(url),
// });
const publicClient = createPublicClient({
  chain: polygon,
  transport: http(url),
});
const walletClient = createWalletClient({
  chain: polygon,
  transport: http(url),
});

const bundler = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" // anvil account (1)
);
const account = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" // anvil account (2)
);

const smartAccountProvider = new SmartAccountV1Provider(
  publicClient,
  SMART_ACCOUNT_V1_FACTORY_ADDRESS,
  SESSION_KEY_MANAGER_ADDRESS
);

let startedAnvil = false;
try {
  await publicClient.getBlock();
  startedAnvil = true;
} catch (error) {
  if ((error as HttpRequestErrorType).shortMessage !== "HTTP request failed.") {
    console.log(error);
  }
}

const testIf = (condition: boolean) => (condition ? test : test.skip);

beforeAll(async () => {
  const abi = [
    {
      type: "function",
      name: "airdrop",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable",
    },
  ];

  const wethBalance = await publicClient.readContract({
    abi: ERC20_ABI,
    address: WETH_ADDRESS,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (wethBalance < 100e18) {
    await walletClient.writeContract({
      address: WETH_ADDRESS,
      abi,
      functionName: "airdrop",
      account,
    });
  }

  const usdcBalance = await publicClient.readContract({
    abi: ERC20_ABI,
    address: USDC_ADDRESS,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (usdcBalance < 100e6) {
    await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi,
      functionName: "airdrop",
      account,
    });
  }
});

describe("createSessionKeyRequest", async () => {
  const smartAccountSalt = 0n;

  testIf(startedAnvil)("create properly", async () => {
    const { sessionKey, request } =
      await smartAccountProvider.createSessionKeyRequest(
        account.address,
        smartAccountSalt
      );
    const signatureHex = await account.signTypedData(request);
    const signature = hexToSignature(signatureHex);
    const permitSessionKeyTx = await walletClient.writeContract({
      address: SESSION_KEY_MANAGER_ADDRESS,
      abi: SESSION_KEY_MANAGER_ABI,
      functionName: "permit",
      args: [
        account.address,
        smartAccountSalt,
        sessionKey.address,
        signature.r,
        signature.s,
        signature.v,
      ],
      account,
    });

    const txReceipt = await publicClient.waitForTransactionReceipt({
      hash: permitSessionKeyTx,
    });
    const event = decodeEventLog({
      abi: SESSION_KEY_MANAGER_ABI,
      topics: txReceipt.logs[0].topics,
      data: txReceipt.logs[0].data,
      eventName: "Permit",
    });
    const smartAccount = await publicClient.readContract({
      abi: SMART_ACCOUNT_V1_FACTORY_ABI,
      address: SMART_ACCOUNT_V1_FACTORY_ADDRESS,
      functionName: "getAddress",
      args: [account.address, smartAccountSalt],
    });
    expect(event.args.smartAccount.toLowerCase()).toEqual(
      smartAccount.toLowerCase()
    );
    expect(event.args.sessionKey.toLowerCase()).toEqual(
      sessionKey.address.toLowerCase()
    );

    const hash = await walletClient.writeContract({
      account,
      abi: SMART_ACCOUNT_V1_FACTORY_ABI,
      address: SMART_ACCOUNT_V1_FACTORY_ADDRESS,
      functionName: "createAccount",
      args: [account.address, smartAccountSalt],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const userOpWithoutSign: UserOperation = {
      sender: smartAccount,
      nonce: 0n,
      initCode: "0x",
      callData: "0x",
      callGasLimit: 0n,
      verificationGasLimit: 0n,
      preVerificationGas: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      paymasterAndData: "0x" as `0x${string}`,
      signature: "0x" as `0x${string}`,
    };
    const userOpHash = await publicClient.readContract({
      abi: ENTRYPOINT_ABI,
      address: ENTRYPOINT_ADDRESS,
      functionName: "getUserOpHash",
      args: [userOpWithoutSign],
    });

    const userOpSignature = await account.signMessage({
      message: { raw: userOpHash },
    });
    const userOp: UserOperation = {
      ...userOpWithoutSign,
      signature: userOpSignature,
    };

    const { result } = await publicClient.simulateContract({
      account: ENTRYPOINT_ADDRESS,
      abi: SMART_ACCOUNT_V1_ABI,
      address: smartAccount,
      functionName: "validateUserOp",
      args: [userOp, userOpHash, 0n],
    });
    expect(result).toEqual(0n);
  });
});

describe.only("createSwapRequest", () => {
  const smartAccountSalt = BigInt(Date.now());

  testIf(startedAnvil)(
    "Deploy smart account if not existed and execute swap",
    async function () {
      const initSmartAccountInput = {
        owner: account.address,
        salt: smartAccountSalt,
      };
      const singlePathSwapInput: SinglePathSwapInput = {
        tokenIn: WETH_ADDRESS,
        tokenOut: USDC_ADDRESS,
        fee: 3000,
        deadline: BigInt(2 ** 255),
        amountIn: BigInt(20_000),
        amountOutMinimum: BigInt(0),
      } as const;

      const { smartAccount, userOpHash, request } =
        await smartAccountProvider.createSwapRequest({
          dex: "uniswapV3",
          swapInput: singlePathSwapInput,
          gasless: true,
          initSmartAccountInput,
        });

      // send tokenIn to smart account
      await walletClient.writeContract({
        account,
        abi: ERC20_ABI,
        address: singlePathSwapInput.tokenIn,
        functionName: "transfer",
        args: [smartAccount, singlePathSwapInput.amountIn],
      });

      const signature = await account.signMessage({
        message: { raw: userOpHash },
      });

      const userOp = { ...request, signature };

      const tx = await walletClient.writeContract({
        account: bundler,
        abi: ENTRYPOINT_ABI,
        address: ENTRYPOINT_ADDRESS,
        functionName: "handleOps",
        args: [[userOp], bundler.address],
      });

      const txReceipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      const smartAccountEvents = [];
      const entrypointEvents = [];
      const poolEvents = [];
      const wethEvents = [];
      const usdcEvents = [];

      for (let log of txReceipt.logs) {
        if (log.address.toLowerCase() === smartAccount.toLowerCase()) {
          smartAccountEvents.push(
            decodeEventLog({
              abi: SMART_ACCOUNT_V1_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        } else if (
          log.address.toLowerCase() === ENTRYPOINT_ADDRESS.toLowerCase()
        ) {
          entrypointEvents.push(
            decodeEventLog({
              abi: ENTRYPOINT_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        } else if (log.address.toLowerCase() === POOL_ADDRESS.toLowerCase()) {
          poolEvents.push(
            decodeEventLog({
              abi: UNISWAP_V3_POOL_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        } else if (log.address.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
          wethEvents.push(
            decodeEventLog({
              abi: ERC20_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        } else if (log.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
          usdcEvents.push(
            decodeEventLog({
              abi: ERC20_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        }
      }

      const smartAccountV1InitializedEvent = smartAccountEvents.find(
        (event) => event.eventName === "SmartAccountV1Initialized"
      );
      expect(smartAccountV1InitializedEvent).toBeDefined();
      const { entryPoint, owner } = smartAccountV1InitializedEvent?.args as {
        entryPoint: `0x${string}`;
        owner: `0x${string}`;
      };
      expect(entryPoint).toEqual(ENTRYPOINT_ADDRESS);
      expect(owner).toEqual(account.address);

      const userOpEvent = entrypointEvents.find(
        (event) => event.eventName === "UserOperationEvent"
      );
      const { success } = userOpEvent?.args as { success: boolean };
      expect(userOpEvent).toBeDefined();
      expect(success).toEqual(true);

      expect(
        poolEvents.find((event) => event.eventName === "Swap")
      ).toBeDefined();
      expect(
        wethEvents.find((event) => event.eventName === "Approval")
      ).toBeDefined();
      expect(
        wethEvents.find((event) => event.eventName === "Transfer")
      ).toBeDefined();
      expect(
        usdcEvents.find((event) => event.eventName === "Transfer")
      ).toBeDefined();
    },
    20000
  );

  testIf(startedAnvil)(
    "Create and execute swap request on existing smart account",
    async function () {
      const smartAccount = await publicClient.readContract({
        abi: SMART_ACCOUNT_V1_FACTORY_ABI,
        address: SMART_ACCOUNT_V1_FACTORY_ADDRESS,
        functionName: "getAddress",
        args: [account.address, smartAccountSalt],
      });

      const singlePathSwapInput: SinglePathSwapInput = {
        tokenIn: WETH_ADDRESS,
        tokenOut: USDC_ADDRESS,
        fee: 3000,
        deadline: BigInt(2 ** 255),
        amountIn: BigInt(20_000),
        amountOutMinimum: BigInt(0),
      } as const;

      const { userOpHash, request } =
        await smartAccountProvider.createSwapRequest({
          smartAccount,
          dex: "uniswapV3",
          swapInput: singlePathSwapInput,
          gasless: true,
        });

      // send tokenIn to smart account
      await walletClient.writeContract({
        account,
        abi: ERC20_ABI,
        address: singlePathSwapInput.tokenIn,
        functionName: "transfer",
        args: [smartAccount, singlePathSwapInput.amountIn],
      });

      const signature = await account.signMessage({
        message: { raw: userOpHash },
      });

      const userOp = { ...request, signature };

      const tx = await walletClient.writeContract({
        account: bundler,
        abi: ENTRYPOINT_ABI,
        address: ENTRYPOINT_ADDRESS,
        functionName: "handleOps",
        args: [[userOp], bundler.address],
      });

      const txReceipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      const entrypointEvents = [];
      const poolEvents = [];
      const wethEvents = [];
      const usdcEvents = [];

      for (let log of txReceipt.logs) {
        if (log.address.toLowerCase() === ENTRYPOINT_ADDRESS.toLowerCase()) {
          entrypointEvents.push(
            decodeEventLog({
              abi: ENTRYPOINT_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        } else if (log.address.toLowerCase() === POOL_ADDRESS.toLowerCase()) {
          poolEvents.push(
            decodeEventLog({
              abi: UNISWAP_V3_POOL_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        } else if (log.address.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
          wethEvents.push(
            decodeEventLog({
              abi: ERC20_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        } else if (log.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
          usdcEvents.push(
            decodeEventLog({
              abi: ERC20_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        }
      }

      const userOpEvent = entrypointEvents.find(
        (event) => event.eventName === "UserOperationEvent"
      );
      const { success } = userOpEvent?.args as { success: boolean };
      expect(userOpEvent).toBeDefined();
      expect(success).toEqual(true);

      expect(
        poolEvents.find((event) => event.eventName === "Swap")
      ).toBeDefined();
      expect(
        wethEvents.find((event) => event.eventName === "Approval")
      ).toBeDefined();
      expect(
        wethEvents.find((event) => event.eventName === "Transfer")
      ).toBeDefined();
      expect(
        usdcEvents.find((event) => event.eventName === "Transfer")
      ).toBeDefined();
    },
    20000
  );
});
