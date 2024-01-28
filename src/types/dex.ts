export type DexName = "uniswapV3" | "pancakeSwapV3";

export type DexAddressesV3 = {
  swapRouter: `0x${string}`;
  factory: `0x${string}`;
  nonfungiblePositionManager: `0x${string}`;
  quoterV2: `0x${string}`;
};

export type Dex = { [dex in DexName]?: DexAddressesV3 };

export type DexChains = {
  [chainId: number]: Dex;
};

export type SinglePathSwapInput = {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  recipient?: `0x${string}`; // if not set, use smart account
  deadline: bigint;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint; // if not set, use 0, which means no limit
};
