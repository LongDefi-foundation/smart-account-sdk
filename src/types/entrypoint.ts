export type ReturnInfo = {
  preOpGas: bigint;
  prefund: bigint;
  sigFailed: boolean;
  validAfter: number;
  validUntil: number;
  paymasterContext: `0x${string}`;
};
