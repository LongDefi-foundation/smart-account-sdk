import { describe, expect, test, beforeAll } from "bun:test";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  parseEther,
  walletActions,
  zeroAddress,
  type HttpRequestErrorType,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  ENTRYPOINT_ABI,
  ERC20_ABI,
  SMART_ACCOUNT_V1_ABI,
  SMART_ACCOUNT_V1_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
  UNISWAP_V3_QUOTER_V2_ABI,
  UNISWAP_V3_SWAP_ROUTER_ABI,
  WETH_ABI,
} from "./abi";
import { ENTRYPOINT_ADDRESS, UNISWAP_V3_ETH_ADDRESSES } from "./addresses";
import { SmartAccountV1Provider } from "./smartAccountV1Provider";
import type { SinglePathSwapInput } from "./types/dex.js";

const rpcUrl = "http://localhost:8545"; // anvil local node
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

const bundler = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" // anvil account (1)
);
const account = privateKeyToAccount(generatePrivateKey());

const smartAccountProvider = new SmartAccountV1Provider(publicClient);

const WETH_ADDRESS = smartAccountProvider.dex.weth;
const TOKEN_ADDRESS = process.env.TEST_TOKEN_ADDRESS as `0x${string}`;
const POOL_ADDRESS = process.env.TEST_POOL_ADDRESS as `0x${string}`;
const TEST_TOKEN_OWNER = process.env.TEST_TOKEN_OWNER as `0x${string}`;

if (!TOKEN_ADDRESS || !POOL_ADDRESS || !TEST_TOKEN_OWNER) {
  throw new Error("Missing environment variables");
}

let startedAnvil = false;
try {
  await publicClient.getBlock();
  startedAnvil = true;
} catch (error) {
  if ((error as HttpRequestErrorType).shortMessage !== "HTTP request failed.") {
    console.log(error);
  }
}

const sendTokenInToSmartAccount = async (
  smartAccount: `0x${string}`,
  tokenIn: `0x${string}`,
  amountIn: bigint
) => {
  if (tokenIn !== WETH_ADDRESS) {
    await walletClient.writeContract({
      account,
      abi: ERC20_ABI,
      address: tokenIn,
      functionName: "transfer",
      args: [smartAccount, amountIn],
    });
  } else {
    await walletClient.sendTransaction({
      account,
      to: smartAccount,
      value: amountIn,
    });
  }
};

beforeAll(async () => {
  if (!startedAnvil) {
    return;
  }

  const testClient = createTestClient({
    mode: "anvil",
    chain: sepolia,
    transport: http(rpcUrl),
  }).extend(walletActions);
  await testClient.setBalance({
    address: account.address,
    value: parseEther("10"),
  });
  await testClient.setBalance({
    address: TEST_TOKEN_OWNER,
    value: parseEther("10"),
  });
  await testClient.impersonateAccount({
    address: TEST_TOKEN_OWNER,
  });
  await testClient.writeContract({
    account: TEST_TOKEN_OWNER,
    abi: ERC20_ABI,
    address: TOKEN_ADDRESS,
    functionName: "transfer",
    args: [account.address, parseEther("10")],
  });
});

describe.if(startedAnvil)("createSwapRequest", () => {
  test.each([
    ["weth", "token", WETH_ADDRESS, TOKEN_ADDRESS],
    ["token", "weth", TOKEN_ADDRESS, WETH_ADDRESS],
  ])(
    "Deploy smart account and execute swap %s -> %s",
    async function (_tokenInName, _tokenOutName, tokenIn, tokenOut) {
      const smartAccountSalt = BigInt(Date.now());
      const initSmartAccountInput = {
        owner: account.address,
        salt: smartAccountSalt,
      };
      const singlePathSwapInput: SinglePathSwapInput = {
        tokenIn,
        tokenOut,
        fee: 3000,
        deadline: BigInt(2 ** 255),
        amountIn: BigInt(10_000),
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
      await sendTokenInToSmartAccount(
        smartAccount,
        tokenIn,
        singlePathSwapInput.amountIn
      );

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
      const tokenEvents = [];
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
              abi: WETH_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        } else if (log.address.toLowerCase() === TOKEN_ADDRESS.toLowerCase()) {
          tokenEvents.push(
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
      if (tokenIn === WETH_ADDRESS) {
        expect(
          wethEvents.find((event) => event.eventName === "Deposit")
        ).toBeDefined();
      }
      if (tokenOut === WETH_ADDRESS) {
        expect(
          wethEvents.find((event) => event.eventName === "Withdrawal")
        ).toBeDefined();
      }
      expect(
        wethEvents.find((event) => event.eventName === "Transfer")
      ).toBeDefined();
      expect(
        tokenEvents.find((event) => event.eventName === "Transfer")
      ).toBeDefined();
    },
    20000
  );

  test.each([
    ["weth", "token", WETH_ADDRESS, TOKEN_ADDRESS],
    ["token", "weth", TOKEN_ADDRESS, WETH_ADDRESS],
  ])(
    "Only execute swap %s -> %s",
    async function (_tokenInName, _tokenOutName, tokenIn, tokenOut) {
      const smartAccountSalt = BigInt(Date.now());
      await walletClient.writeContract({
        account,
        abi: SMART_ACCOUNT_V1_FACTORY_ABI,
        address: smartAccountProvider.factory,
        functionName: "createAccount",
        args: [account.address, smartAccountSalt],
      });

      const smartAccount = await publicClient.readContract({
        abi: SMART_ACCOUNT_V1_FACTORY_ABI,
        address: smartAccountProvider.factory,
        functionName: "getAddress",
        args: [account.address, smartAccountSalt],
      });
      const singlePathSwapInput: SinglePathSwapInput = {
        tokenIn,
        tokenOut,
        fee: 3000,
        deadline: BigInt(2 ** 255),
        amountIn: BigInt(20_000),
        amountOutMinimum: BigInt(0),
      } as const;

      // send tokenIn to smart account
      await sendTokenInToSmartAccount(
        smartAccount,
        tokenIn,
        singlePathSwapInput.amountIn
      );

      const { userOpHash, request } =
        await smartAccountProvider.createSwapRequest({
          orderId: 0,
          smartAccount,
          dex: "uniswapV3",
          swapInput: singlePathSwapInput,
          gasless: true,
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
      const tokenEvents = [];
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
              abi: WETH_ABI,
              topics: log.topics,
              data: log.data,
            })
          );
        } else if (log.address.toLowerCase() === TOKEN_ADDRESS.toLowerCase()) {
          tokenEvents.push(
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
        wethEvents.find((event) => event.eventName === "Transfer")
      ).toBeDefined();
      expect(
        tokenEvents.find((event) => event.eventName === "Transfer")
      ).toBeDefined();
    },
    20000
  );
});

describe.if(startedAnvil)("call with JSON RPC", () => {
  test("Simulate handleOp", async () => {
    try {
      const smartAccountSalt = BigInt(Date.now());
      const smartAccount = await publicClient.readContract({
        abi: SMART_ACCOUNT_V1_FACTORY_ABI,
        address: smartAccountProvider.factory,
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
          address: smartAccountProvider.factory,
          functionName: "createAccount",
          args: [account.address, smartAccountSalt],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }

      const singlePathSwapInput: SinglePathSwapInput = {
        tokenIn: WETH_ADDRESS,
        tokenOut: TOKEN_ADDRESS,
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
              sqrtPriceLimitX96: 0n,
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
  }, 20000);
});
