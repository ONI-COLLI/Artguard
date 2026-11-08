import { useState } from 'react';
import { useConnection, useWriteContract, usePublicClient } from 'wagmi';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { Address } from 'viem';
import { marketplaceAbi, type RevenueAllocation } from '../../shared/marketplace';
import { ChainAmount } from './currency';
import { shortAddress } from '../../shared/blockchain';
import { useData, useFeedback } from '../lib/workspace';
import { useMarketStatus, walletError } from '../lib/blockchain';
import { api } from '../lib/api';
import { Button } from './ui';
export function MarketProceeds({ onWithdraw }: { onWithdraw?: () => void }) {
  const { user } = useData(),
    market = useMarketStatus(),
    connection = useConnection(),
    write = useWriteContract(),
    publicClient = usePublicClient(),
    { notify } = useFeedback(),
    [phase, setPhase] = useState('');
  const query = useQuery({
    queryKey: ['blockchain', 'proceeds', user?.id, user?.wallet?.address],
    queryFn: () =>
      api<{
        amountWei: string;
        balances: { amountWei: string; contractAddress: Address; version: number }[];
        earnings: (RevenueAllocation & {
          quoteId: string;
          title: string;
          date: string;
          transactionHash: string;
        })[];
      }>('/blockchain/proceeds'),
    enabled: !!user?.wallet && !!market.data?.ready,
    refetchInterval: 15000,
    retry: false,
  });
  const withdraw = useMutation({
    mutationFn: async (contractAddress: Address) => {
      if (
        !query.data ||
        !connection.address ||
        connection.chainId !== 31337 ||
        connection.address.toLowerCase() !== user?.wallet?.address.toLowerCase()
      )
        throw new Error('Connect your linked wallet on ArtGuard Local to withdraw test earnings.');
      setPhase('Confirm the withdrawal in your wallet…');
      const hash = await write.mutateAsync({
        address: contractAddress,
        abi: marketplaceAbi,
        functionName: 'withdraw',
        account: connection.address,
        chainId: 31337,
      });
      setPhase('Withdrawal sent. Waiting for confirmation…');
      const receipt = await publicClient!.waitForTransactionReceipt({ hash, timeout: 30000 });
      if (receipt.status !== 'success')
        throw new Error('The withdrawal reverted. Check your contract balance before retrying.');
      return hash;
    },
    onSuccess: () => {
      setPhase('');
      void query.refetch();
      onWithdraw?.();
      notify({
        title: 'Test earnings withdrawn',
        detail: 'The local contract transferred test ETH to your wallet.',
      });
    },
    onError: () => {
      setPhase('');
      void query.refetch();
    },
  });
  const balances =
    query.data?.balances.filter((b) => b.version !== 1 || BigInt(b.amountWei) > 0n) || [];
  if (!user?.wallet) return null;
  return (
    <div className="market-proceeds">
      <strong>Available earnings</strong>
      <p>
        {query.data ? (
          <ChainAmount wei={query.data.amountWei} />
        ) : market.data?.ready ? (
          'Checking contract balance…'
        ) : (
          'Local marketplace offline'
        )}
      </p>
      {balances.map((b) => (
        <div key={b.contractAddress} className="contract-balance">
          {balances.length > 1 && (
            <small className="muted">
              {b.version === 1 ? 'Previous marketplace' : 'Marketplace'} ·{' '}
              {shortAddress(b.contractAddress)} · <ChainAmount wei={b.amountWei} />
            </small>
          )}
          <Button
            className="full"
            busy={withdraw.isPending}
            disabled={
              !query.data ||
              BigInt(b.amountWei) === 0n ||
              connection.address?.toLowerCase() !== user.wallet?.address.toLowerCase() ||
              connection.chainId !== 31337
            }
            onClick={() => withdraw.mutate(b.contractAddress)}
          >
            {b.version === 1 ? 'Withdraw previous earnings' : 'Withdraw test earnings'}
          </Button>
        </div>
      ))}
      <p className="small-text muted">Payouts go to your linked wallet.</p>
      {!!query.data?.earnings.length && (
        <details className="payout-details">
          <summary>Verified revenue receipts ({query.data.earnings.length})</summary>
          {query.data.earnings.map((e) => (
            <div key={e.quoteId} className="payout-recipient">
              <span>
                {e.title}
                <small>
                  {e.creator ? 'Creator' : 'Co-author'} · {e.percent}% of net proceeds
                </small>
              </span>
              <strong>
                <ChainAmount wei={e.amountWei} />
              </strong>
            </div>
          ))}
        </details>
      )}
      {phase && (
        <p className="small-text" role="status">
          {phase}
        </p>
      )}
      {(withdraw.error || query.error) && (
        <p role="alert" className="form-error">
          {walletError(withdraw.error || query.error)}
        </p>
      )}
    </div>
  );
}
