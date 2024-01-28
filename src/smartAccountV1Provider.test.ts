import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  hexToSignature,
  http,
  zeroAddress,
  type HttpRequestErrorType,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import {
  ENTRYPOINT_ABI,
  ERC20_ABI,
  SESSION_KEY_MANAGER_ABI,
  SMART_ACCOUNT_V1_ABI,
  SMART_ACCOUNT_V1_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_QUOTER_V2_ABI,
  UNISWAP_V3_SWAP_ROUTER_ABI,
} from "./abi";
import { ENTRYPOINT_ADDRESS, UNISWAP_V3_ETH_ADDRESSES } from "./addresses";
import { SmartAccountV1Provider } from "./smartAccountV1Provider";
import type { SinglePathSwapInput } from "./types/dex.js";
import type { UserOperation } from "./types/smartAccountV1.js";

const WETH_ADDRESS = process.env.TEST_WETH_ADDRESS as `0x${string}`;
const USDC_ADDRESS = process.env.TEST_USDC_ADDRESS as `0x${string}`;
const POOL_ADDRESS = process.env.TEST_POOL_ADDRESS as `0x${string}`;
const SMART_ACCOUNT_V1_FACTORY_ADDRESS = process.env
  .TEST_SMART_ACCOUNT_V1_FACTORY_ADDRESS as `0x${string}`;
const SESSION_KEY_MANAGER_ADDRESS = process.env
  .TEST_SESSION_KEY_MANAGER_ADDRESS as `0x${string}`;

const rpcUrl = "http://localhost:8545"; // anvil local node
// const testClient = createTestClient({
//   mode: "anvil",
//   chain: polygon,
//   transport: http(url),
// });
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  chain: mainnet,
  transport: http(rpcUrl),
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

describe("createSwapRequest", () => {
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
          orderId: 0,
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
          orderId: 0,
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

describe("call with JSON RPC", () => {
  testIf(startedAnvil)(
    "Simulate handleOp",
    async () => {
      try {
        const smartAccountSalt = BigInt(Date.now());
        const smartAccount = await publicClient.readContract({
          abi: SMART_ACCOUNT_V1_FACTORY_ABI,
          address: SMART_ACCOUNT_V1_FACTORY_ADDRESS,
          functionName: "getAddress",
          args: [account.address, smartAccountSalt],
        });
        const initSmartAccountInput = {
          owner: account.address,
          salt: smartAccountSalt,
        };

        const init = true;
        if (!init) {
          const tx = await walletClient.writeContract({
            account,
            abi: SMART_ACCOUNT_V1_FACTORY_ABI,
            address: SMART_ACCOUNT_V1_FACTORY_ADDRESS,
            functionName: "createAccount",
            args: [account.address, smartAccountSalt],
          });
          await publicClient.waitForTransactionReceipt({ hash: tx });
        }

        const singlePathSwapInput: SinglePathSwapInput = {
          tokenIn: WETH_ADDRESS,
          tokenOut: USDC_ADDRESS,
          fee: 3000,
          deadline: BigInt(2 ** 255),
          amountIn: BigInt(10),
          // amountOutMinimum: BigInt(1_000_000_000_000),
          amountOutMinimum: BigInt(0),
        } as const;

        // send tokenIn to smart account
        await walletClient.writeContract({
          account,
          abi: ERC20_ABI,
          address: singlePathSwapInput.tokenIn,
          functionName: "transfer",
          args: [smartAccount, singlePathSwapInput.amountIn * 2n],
        });

        const { userOpHash, request } =
          await smartAccountProvider.createSwapRequest({
            orderId: 0,
            smartAccount,
            initSmartAccountInput: init ? initSmartAccountInput : undefined,
            dex: "uniswapV3",
            swapInput: singlePathSwapInput,
            gasless: true,
          });
        const signature = await account.signMessage({
          message: { raw: userOpHash },
        });
        const userOp = { ...request, signature };

        const executeBatchCalldata = decodeFunctionData({
          abi: SMART_ACCOUNT_V1_ABI,
          data: userOp.callData,
        });
        if (!executeBatchCalldata) {
          throw new Error("invalid callData");
        }
        const swapCalldata = decodeFunctionData({
          abi: UNISWAP_V3_SWAP_ROUTER_ABI,
          data: (executeBatchCalldata.args[2] as any)[1],
        });
        const exactInputSingle = swapCalldata.args[0] as SinglePathSwapInput;
        const smartAccountBalance = await publicClient.readContract({
          abi: ERC20_ABI,
          address: exactInputSingle.tokenIn,
          functionName: "balanceOf",
          args: [smartAccount],
        });
        if (smartAccountBalance < exactInputSingle.amountIn) {
          console.log("Smart account balance is not enough");
          return;
        }

        const data = encodeFunctionData({
          abi: ENTRYPOINT_ABI,
          functionName: "simulateHandleOp",
          args: [userOp, zeroAddress, "0x"],
        });

        const handleOpResponse = await fetch(rpcUrl, {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_call",
            params: [
              {
                from: bundler.address,
                to: ENTRYPOINT_ADDRESS,
                data,
              },
              "latest",
            ],
            id: 1,
          }),
          headers: {
            "Content-Type": "application/json",
          },
        });
        const handleOpResult = await handleOpResponse.json();
        const decodedRes = decodeErrorResult({
          abi: ENTRYPOINT_ABI,
          data: handleOpResult.error.data,
        });
        if (decodedRes.errorName !== "ExecutionResult") {
          throw new Error(`handleOps error: ${decodedRes.errorName}`);
        }

        if (userOp.initCode !== "0x") {
          const quoteCalldata = encodeFunctionData({
            abi: UNISWAP_V3_QUOTER_V2_ABI,
            functionName: "quoteExactInputSingle",
            args: [
              {
                tokenIn: singlePathSwapInput.tokenIn,
                tokenOut: singlePathSwapInput.tokenOut,
                amountIn: singlePathSwapInput.amountIn,
                fee: singlePathSwapInput.fee,
                sqrtPriceLimitX96: singlePathSwapInput.sqrtPriceLimitX96 || 0n,
              },
            ],
          });
          const quoteExactInputSingleResponse = await fetch(rpcUrl, {
            headers: {
              "Content-Type": "application/json",
            },
            method: "POST",
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "eth_call",
              params: [
                {
                  from: zeroAddress,
                  to: UNISWAP_V3_ETH_ADDRESSES.quoterV2,
                  data: quoteCalldata,
                },
                "latest",
              ],
              id: 1,
            }),
          });
          const { result } = await quoteExactInputSingleResponse.json();

          // [amountOut, sqrtPriceLimitX96After, initializedTicksCrossed, gasEstimate]
          const quoteResult = decodeFunctionResult({
            abi: UNISWAP_V3_QUOTER_V2_ABI,
            functionName: "quoteExactInputSingle",
            data: result,
          });
          console.log(quoteResult);
          if (quoteResult[0] < singlePathSwapInput.amountOutMinimum) {
            throw new Error("amountOut is too small");
          }
        } else {
          const executeBatchResponse = await fetch(rpcUrl, {
            headers: {
              "Content-Type": "application/json",
            },
            method: "POST",
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "eth_call",
              params: [
                {
                  from: ENTRYPOINT_ADDRESS,
                  to: smartAccount,
                  data: userOp.callData,
                },
                "latest",
              ],
              id: 1,
            }),
          });
          const result = await executeBatchResponse.json();
          if (result.error) {
            throw new Error("Execute batch failed:", result.message);
          }
        }

        console.log("Simulation success");
      } catch (e) {
        console.log("Simulation failed:", e);
      }
    },
    20000
  );
});
