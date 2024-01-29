import { expect, test } from "bun:test";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { convertPriceToSqrtX96, convertSqrtX96toPrice } from "./uniswapV3";

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
});

test("convertSqrtX96toPrice()", async () => {
  const price = await convertSqrtX96toPrice(
    publicClient,
    [
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    ],
    2018382873588440326581633304624437
  );

  // Calculation: https://blog.uniswap.org/uniswap-v3-math-primer#how-do-i-calculate-the-current-exchange-rate
  expect(price.toFixed(6)).toEqual("1540.820552");
});

test("convertPriceToSqrtX96()", async () => {
  const sqrtX96 = await convertPriceToSqrtX96(
    publicClient,
    [
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    ],
    1540.820552
  );
  expect((sqrtX96 / 2018382873588440326581633304624437).toFixed(6)).toEqual(
    "1.000000"
  );
});
