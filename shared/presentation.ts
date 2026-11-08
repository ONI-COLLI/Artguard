export interface PresentationEvidence {
  checkedAt: string;
  chainId: 31337;
  online: boolean;
  message: string;
  contracts: {
    name: string;
    address: string;
    transactionHash: string;
    verified: boolean;
    block: string | null;
    bytecodeBytes: number;
  }[];
  runs: {
    label: string;
    command: string;
    completedAt: string;
    passed: number;
    failed: number;
    exitCode: number;
    logSha256: string;
  }[];
}
