import type { DexChains } from "../types/dex";
import type { SmartAccountV1Chains } from "../types/smartAccountV1";

export const ENTRYPOINT_ADDRESS =
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as const;

export const UNISWAP_V3_ETH_ADDRESSES = {
  factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
} as const;

export const SMART_ACCOUNT_V1_CHAINS: SmartAccountV1Chains = {
  137: {
    entrypoint: ENTRYPOINT_ADDRESS,
    smartAccountFactoryV1: "0x", // TODO: update
    sessionKeyManager: "0x", // TODO: update
  },
  80001: {
    entrypoint: ENTRYPOINT_ADDRESS,
    smartAccountFactoryV1: "0x3917d4c08477FA10d7c8CC91936D84957224B2a8",
    sessionKeyManager: "0x0a46d7348ab5f2fA6cfA261Ccf6276853Fcc0746",
  },
};

export const DEX_CHAINS: DexChains = {
  137: {
    uniswapV3: UNISWAP_V3_ETH_ADDRESSES,
  },
  80001: {
    uniswapV3: UNISWAP_V3_ETH_ADDRESSES,
  },
};
