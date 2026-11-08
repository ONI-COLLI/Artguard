export interface PublicChainProof {
  checkedAt: string;
  source: 'anvil_rpc';
  rpcUrl: string;
  chainId: number | null;
  headBlock: string | null;
  status: 'verified' | 'failed' | 'unavailable' | 'not_found';
  message: string;
  checks: { id: string; label: string; passed: boolean }[];
  transaction: {
    hash: string;
    blockNumber: string;
    blockHash: string;
    buyer: string;
    contract: string;
    amountWei: string;
    feeWei: string;
    gasWei: string;
    licenses: {
      quoteId: string;
      fileHash: string;
      licenseType: number;
      seller: string;
      owned: boolean;
      quoteUsed: boolean;
      stateConsistent?: boolean;
      validUntil?: string | null;
    }[];
    allocations: {
      role: 'Platform' | 'Creator' | 'Co-author';
      wallet: string;
      amountWei: string;
    }[];
    credits: { wallet: string; amountWei: string | null }[];
    withdrawals: {
      wallet: string;
      amountWei: string;
      transactionHash: string;
      blockNumber: string;
    }[];
    withdrawalScan: 'complete' | 'recent' | 'unavailable';
    withdrawalsFromBlock: string;
    receipt: {
      status: string;
      transactionHash: string;
      from: string;
      to: string | null;
      blockHash: string;
      blockNumber: string;
      logs: { address: string; topics: readonly string[]; data: string }[];
    };
  } | null;
}
