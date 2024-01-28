import type { DexChains } from "../types/dex";
import type { SmartAccountV1Chains } from "../types/smartAccountV1";

export const ENTRYPOINT_ADDRESS =
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as const;

export const UNISWAP_V3_ETH_ADDRESSES = {
  factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
} as const;

export const SMART_ACCOUNT_V1_CHAINS: SmartAccountV1Chains = {
  11155111: {
    entrypoint: ENTRYPOINT_ADDRESS,
    smartAccountFactoryV1: "0xe6A2C54B2e4695013f98415D71c2CF9CF0144C46",
    sessionKeyManager: "0x598DCEF8eBA700aB35deF0EC5644cda5747668D5",
  },
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
  1: {
    uniswapV3: UNISWAP_V3_ETH_ADDRESSES,
  },
  11155111: {
    uniswapV3: {
      factory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
      swapRouter: "0xc671db9c8c2e650FB5C9B9F119522700e5b7A958",
      nonfungiblePositionManager: "0x1238536071E1c677A632429e3655c799b22cDA52",
      quoterV2: "0xAb32382C0FE4F7FDC63E3A5d87e9545D64aa4c3e",
    },
  },
  137: {
    uniswapV3: UNISWAP_V3_ETH_ADDRESSES,
  },
  80001: {
    uniswapV3: UNISWAP_V3_ETH_ADDRESSES,
  },
};
