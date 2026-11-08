export interface BlockchainDemo {
  checkedAt: string;
  network: {
    ready: boolean;
    marketplaceReady: boolean;
    chainId: number;
    blockNumber: string | null;
    registryAddress: string | null;
    marketplaceAddress: string | null;
    message: string;
  };
  sale: {
    title: string;
    license: string;
    transactionHash: string;
    contractAddress: string;
    buyerWallet: string;
    blockNumber: string | null;
    amountWei: string;
    feeWei: string;
    allocations: {
      name: string;
      wallet: string;
      percent: number;
      amountWei: string;
      creator: boolean;
    }[];
    proof: 'verified' | 'unavailable' | 'different_instance' | 'mismatch';
    proofMessage: string;
  } | null;
}
