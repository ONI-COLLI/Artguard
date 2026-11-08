import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnection, useWriteContract, usePublicClient } from 'wagmi';
import { api } from '../lib/api';
import { useData, useDownload, workspaceKey } from '../lib/workspace';
import { walletError } from '../lib/blockchain';
import { useDialog } from './dialogs';
import { WalletPanel } from './wallet';
import { Button } from './ui';
import { ChainAmount } from './currency';
import { escrowAbi, type EscrowOrder } from '../../shared/escrow';
const states = {
  none: 'Not funded',
  funded: 'Payment held in escrow',
  delivered: 'Ready for your review',
  disputed: 'Dispute under review',
  released: 'Completed · license issued',
  refunded: 'Refund approved',
};
const time = (seconds: number) => new Date(seconds * 1000).toLocaleString();
export function EscrowOrders({ manager = false }: { manager?: boolean }) {
  const { user } = useData();
  const query = useQuery({
    queryKey: ['escrow-orders', user?.id, manager],
    queryFn: () =>
      api<{ orders: EscrowOrder[] }>('/escrow/orders' + (manager ? '?scope=manager' : '')),
    enabled: !!user?.emailVerified && (!manager || user.isManager),
    retry: false,
    refetchInterval: 10000,
  });
  if (!user || (manager && !user.isManager)) return null;
  return (
    <section
      className="escrow-orders"
      aria-label={manager ? 'Site escrow orders' : 'Your escrow orders'}
    >
      <div className="panel-heading">
        <h2>{manager ? 'Escrow & disputes' : 'Escrow orders'}</h2>
        <Button className="small" busy={query.isFetching} onClick={() => void query.refetch()}>
          Refresh orders
        </Button>
      </div>
      {query.error && (
        <p className="form-error" role="alert">
          {query.error.message}
        </p>
      )}
      {query.isPending && <p role="status">Checking escrow orders…</p>}
      {!query.isPending && !query.error && !query.data?.orders.length && (
        <p className="muted small-text">
          New blockchain payments use escrow. Orders appear here after the deposit is verified.
        </p>
      )}
      <div className="escrow-grid">
        {query.data?.orders.map((order) =>
          order.error ? (
            <article className="panel escrow-card" key={order.id}>
              <h3>{order.title}</h3>
              <p>Last recorded status: {states[order.state]}</p>
              <p role="alert" className="form-error">
                Live check unavailable: {order.error}
              </p>
            </article>
          ) : (
            <EscrowCard key={order.id} order={order} />
          ),
        )}
      </div>
    </section>
  );
}
function EscrowCard({ order: o }: { order: EscrowOrder }) {
  const connection = useConnection(),
    write = useWriteContract(),
    publicClient = usePublicClient(),
    dialog = useDialog(),
    client = useQueryClient(),
    download = useDownload();
  const [reason, setReason] = useState('');
  const action = useMutation({
    mutationFn: async (
      name: 'markDelivered' | 'release' | 'dispute' | 'refund' | 'withdrawRefund',
    ) => {
      if (!connection.address || connection.chainId !== 31337)
        throw new Error('Connect your linked wallet on ArtGuard Local first.');
      if (name === 'markDelivered')
        await api('/escrow/' + o.id + '/delivery-check', { method: 'POST', data: {} });
      const hash = await write.writeContractAsync({
        address: o.contractAddress,
        abi: escrowAbi,
        functionName: name,
        args: name === 'withdrawRefund' ? undefined : [o.id],
      });
      if (!publicClient)
        throw new Error(
          'The local blockchain client is unavailable. Refresh to verify the saved transaction.',
        );
      const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
      if (receipt.status !== 'success')
        throw new Error('The transaction reverted. Refresh the order to check its current state.');
      // Confirmation is recovered from chain events even if this browser closes.
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          await api('/escrow/' + o.id + '/sync', { method: 'POST', data: {} });
          break;
        } catch (error) {
          if (attempt === 11) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      return hash;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['escrow-orders'] });
      void client.invalidateQueries({ queryKey: workspaceKey });
      void client.invalidateQueries({ queryKey: ['blockchain'] });
    },
  });
  const resolve = useMutation({
    mutationFn: (refund: boolean) =>
      api('/escrow/' + o.id + '/resolve', { method: 'POST', data: { refund, reason } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['escrow-orders'] });
      void client.invalidateQueries({ queryKey: workspaceKey });
    },
  });
  const busy = action.isPending || resolve.isPending;
  const expected = o.sellerAccount ? o.seller : o.buyer;
  const connected =
    connection.address?.toLowerCase() === expected.toLowerCase() && connection.chainId === 31337;
  const now = Math.max(o.checkedAt, Math.floor(Date.now() / 1000));
  const overdue = o.state === 'funded' && now >= o.deliveryDeadline;
  const reviewDone = o.state === 'delivered' && now >= o.reviewDeadline;
  const disputeDone = o.state === 'disputed' && now >= o.disputeDeadline;
  const run = (name: Parameters<typeof action.mutate>[0]) => action.mutate(name);
  return (
    <article className="panel escrow-card">
      <div className="escrow-card-title">
        <div>
          <span className={'escrow-status escrow-' + o.state}>{states[o.state]}</span>
          <h3>
            <Link to={'/artwork/' + o.artworkId}>{o.title}</Link>
          </h3>
          <p className="muted small-text">
            {o.buyerAccount
              ? 'You are the buyer'
              : o.sellerAccount
                ? 'You are the seller'
                : 'Manager review'}
          </p>
        </div>
        <strong>
          <ChainAmount wei={o.amountWei} />
        </strong>
      </div>
      {o.state === 'funded' && (
        <p>
          The seller must confirm delivery by <time>{time(o.deliveryDeadline)}</time>. The payment
          is held and the license has not started.
        </p>
      )}
      {o.state === 'delivered' && (
        <p>
          Inspect the delivered file, then accept it or open a dispute by{' '}
          <time>{time(o.reviewDeadline)}</time>. After that, the payment can be released with a
          transaction.
        </p>
      )}
      {o.state === 'disputed' && (
        <p>
          A manager can release the payment or return it to the buyer. If no decision is made by{' '}
          <time>{time(o.disputeDeadline)}</time>, a refund can be claimed.
        </p>
      )}
      {o.state === 'released' && (
        <p>
          The license is available in My licenses. The seller and co-authors can withdraw their
          credits from Wallet.
        </p>
      )}
      {o.state === 'refunded' && (
        <p>
          No license was issued. The buyer can withdraw the full payment; network gas is separate.
        </p>
      )}
      {(o.buyerAccount || o.sellerAccount) && !connected && (
        <Button
          className="small"
          onClick={() => dialog.open('Your blockchain wallet', <WalletPanel />)}
        >
          Connect this account’s wallet
        </Button>
      )}
      <div className="actions escrow-actions">
        {o.sellerAccount && o.state === 'funded' && !overdue && (
          <Button
            className="primary"
            disabled={busy || !connected}
            onClick={() => run('markDelivered')}
          >
            Confirm file delivery
          </Button>
        )}
        {o.buyerAccount && ['delivered', 'disputed', 'released'].includes(o.state) && (
          <Button
            busy={download.pending}
            onClick={() => void download.run('/api/escrow/' + o.id + '/preview')}
          >
            Inspect watermarked preview
          </Button>
        )}
        {o.buyerAccount && o.state === 'delivered' && (
          <Button className="primary" disabled={busy || !connected} onClick={() => run('release')}>
            Accept & release payment
          </Button>
        )}
        {o.buyerAccount && o.state === 'delivered' && !reviewDone && (
          <Button disabled={busy || !connected} onClick={() => run('dispute')}>
            Open dispute
          </Button>
        )}
        {o.sellerAccount && reviewDone && (
          <Button className="primary" disabled={busy || !connected} onClick={() => run('release')}>
            Release after review period
          </Button>
        )}
        {(o.buyerAccount || o.sellerAccount) && (overdue || disputeDone) && (
          <Button disabled={busy || !connected} onClick={() => run('refund')}>
            Claim full refund
          </Button>
        )}
        {o.sellerAccount &&
          ['funded', 'delivered', 'disputed'].includes(o.state) &&
          !overdue &&
          !disputeDone && (
            <Button disabled={busy || !connected} onClick={() => run('refund')}>
              Refund buyer
            </Button>
          )}
        {o.buyerAccount && BigInt(o.refundBalanceWei) > 0n && (
          <Button
            className="primary"
            disabled={busy || !connected}
            onClick={() => run('withdrawRefund')}
          >
            Withdraw available refund · <ChainAmount wei={o.refundBalanceWei} />
          </Button>
        )}
      </div>
      {o.manager && o.state === 'disputed' && !disputeDone && (
        <div className="escrow-manager">
          <label className="field-label" htmlFor={'decision-' + o.id}>
            Decision reason
          </label>
          <textarea
            id={'decision-' + o.id}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={10}
            maxLength={1000}
          />
          <div className="actions">
            <Button
              disabled={busy || reason.trim().length < 10}
              onClick={() => resolve.mutate(true)}
            >
              Resolve: full refund
            </Button>
            <Button
              className="primary"
              disabled={busy || reason.trim().length < 10}
              onClick={() => resolve.mutate(false)}
            >
              Resolve: release payment
            </Button>
          </div>
          <p className="field-hint">
            The local platform arbiter signs the transaction. Your decision and reason are recorded.
          </p>
        </div>
      )}
      {busy && <p role="status">Confirm the transaction and wait for blockchain verification…</p>}
      {(action.error || resolve.error) && (
        <p className="form-error" role="alert">
          {walletError(action.error || resolve.error)}
        </p>
      )}
      <details className="escrow-details">
        <summary>Transaction details</summary>
        <p>
          Order: <code>{o.id}</code>
        </p>
        <p>
          Deposit: <code>{o.fundingHash}</code>
        </p>
        {o.releaseHash && (
          <p>
            Release: <code>{o.releaseHash}</code>
          </p>
        )}
        {o.refundHash && (
          <p>
            Refund: <code>{o.refundHash}</code>
          </p>
        )}
        <Link to="/blockchain-demo">Verify escrow on the blockchain →</Link>
      </details>
    </article>
  );
}
