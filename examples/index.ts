import { SMART_ACCOUNT_V1_FACTORY_ABI } from "@/abi";
import { SmartAccountV1Provider } from "@/index";
import {
  createTestClient,
  http,
  parseEther,
  publicActions,
  walletActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const rpcUrl = process.env.RPC_URL || "http://localhost:8545"; // anvil local node
const testClient = createTestClient({
  mode: "anvil",
  chain: sepolia,
  transport: http(rpcUrl),
})
  .extend(publicActions)
  .extend(walletActions);
const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
); //anvil account 0

const smartAccountProvider = new SmartAccountV1Provider(testClient);
const WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const TOKEN_ADDRESS = "0x11cB8EF24755bc347AAe8b9694f24d66FE94d6c2";

const port = process.env.PORT || 8080;
console.log(`Server is running on http://localhost:${port}`);
Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/order" && req.method == "POST") {
      return generateOrder(req);
    }
    // if (url.pathname === "/swap" && req.method == "POST") {
    //   return autoSwap(req);
    // }
    return Response.json(
      {
        error: "Not found",
      },
      {
        status: 404,
      }
    );
  },
});

async function generateOrder(req: Request): Promise<Response> {
  try {
    const { initSmartAccount }: { initSmartAccount: boolean } =
      await req.json();

    let initSmartAccountInput;
    let smartAccountAddress;
    const smartAccountSalt = BigInt(Date.now());
    if (!initSmartAccount) {
      await testClient.setBalance({
        address: account.address,
        value: parseEther("1"),
      });

      await testClient.writeContract({
        account,
        abi: SMART_ACCOUNT_V1_FACTORY_ABI,
        address: smartAccountProvider.factory!,
        functionName: "createAccount",
        args: [account.address, smartAccountSalt],
      });
      smartAccountAddress = await smartAccountProvider.getSmartAccountAddress(
        account.address,
        smartAccountSalt
      );
    } else {
      initSmartAccountInput = {
        salt: smartAccountSalt,
        owner: account.address,
      };
    }

    const { smartAccount, userOpHash, request } =
      await smartAccountProvider.createSwapRequest({
        dex: "uniswapV3",
        swapInput: {
          tokenIn: WETH_ADDRESS,
          tokenOut: TOKEN_ADDRESS,
          fee: 3000,
          deadline: BigInt(2 ** 255),
          amountIn: BigInt(10_000),
          amountOutMinimum: BigInt(0),
        },
        gasless: true,
        smartAccount: smartAccountAddress,
        initSmartAccountInput,
      });
    const signature = await account.signMessage({
      message: { raw: userOpHash },
    });
    const userOperation = { ...request, signature };

    return new Response(
      JSON.stringify({ smartAccount, userOperation }, (_key, value) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      })
    );
  } catch (e) {
    return Response.json(
      { error: (e as { message: string }).message },
      { status: 400 }
    );
  }
}
