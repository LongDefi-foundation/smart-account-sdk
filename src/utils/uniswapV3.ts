import { type Chain, type PublicClient, type Transport } from "viem";
import { ERC20_ABI } from "../abi";

export async function convertSqrtX96toPrice(
  publicClient: PublicClient<Transport, Chain>,
  tokens: `0x${string}`[],
  sqrtPriceX96: number
): Promise<number> {
  let token0;
  let token1;
  if (tokens[0].toLowerCase() < tokens[1].toLowerCase()) {
    token0 = tokens[0];
    token1 = tokens[1];
  } else {
    token0 = tokens[1];
    token1 = tokens[0];
  }

  const decimal0 = await publicClient.readContract({
    abi: ERC20_ABI,
    address: token0,
    functionName: "decimals",
  });
  const decimal1 = await publicClient.readContract({
    abi: ERC20_ABI,
    address: token1,
    functionName: "decimals",
  });

  const sqrtPrice = sqrtPriceX96 / 2 ** 96;
  const price = sqrtPrice ** 2;

  const adjustedPrice = 10 ** decimal1 / (price * 10 ** decimal0);

  return adjustedPrice;
}

export async function convertPriceToSqrtX96(
  publicClient: PublicClient<Transport, Chain>,
  tokens: `0x${string}`[],
  price: number
): Promise<number> {
  let token0;
  let token1;
  if (tokens[0].toLowerCase() < tokens[1].toLowerCase()) {
    token0 = tokens[0];
    token1 = tokens[1];
  } else {
    token0 = tokens[1];
    token1 = tokens[0];
  }

  const decimal0 = await publicClient.readContract({
    abi: ERC20_ABI,
    address: token0,
    functionName: "decimals",
  });
  const decimal1 = await publicClient.readContract({
    abi: ERC20_ABI,
    address: token1,
    functionName: "decimals",
  });

  const normalizedPrice = 10 ** decimal1 / (price * 10 ** decimal0);
  const sqrtPrice = Math.sqrt(normalizedPrice);
  const sqrtPriceX96 = sqrtPrice * 2 ** 96;
  return sqrtPriceX96;
}
