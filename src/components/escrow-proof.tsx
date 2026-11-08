import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button } from './ui';
import { testEth } from '../../shared/marketplace';
import type { EscrowProof as Proof } from '../../shared/escrow-proof';
export function EscrowProof() {
  const [input, setInput] = useState(''),
    [hash, setHash] = useState('');
  const query = useQuery({
    queryKey: ['escrow-proof', hash],
    queryFn: () =>
      api<Proof>(
        '/blockchain/escrow-proof' + (hash ? '?transactionHash=' + encodeURIComponent(hash) : ''),
      ),
    retry: false,
  });
  const data = query.data && Array.isArray(query.data.orders) ? query.data : null;
  return (
    <section className="panel escrow-proof">
      <h2>Verify a real escrow payment</h2>
      <p className="muted">
        Reads the local blockchain directly. No login or database purchase record is required.
      </p>
      <form
        className="escrow-proof-form"
        onSubmit={(e) => {
          e.preventDefault();
          setHash(input.trim());
          if (input.trim() === hash) void query.refetch();
        }}
      >
        <label className="field-label" htmlFor="escrow-proof-hash">
          Deposit transaction hash (leave empty for the latest)
        </label>
        <div className="actions">
          <input
            id="escrow-proof-hash"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x…"
            pattern="0x[a-fA-F0-9]{64}"
          />
          <Button type="submit" busy={query.isFetching}>
            Verify escrow
          </Button>
        </div>
      </form>
      {query.error && (
        <p role="alert" className="form-error">
          {query.error.message}
        </p>
      )}
      {query.isFetching && (
        <p role="status">Reading deposit, contract state and settlement events…</p>
      )}
      {data && !query.error && (
        <>
          <p role="status">{data.message}</p>
          <ul className="chain-proof-checks">
            {data.checks.map((c, i) => (
              <li className={c.passed ? 'passed' : 'failed'} key={i}>
                {c.passed ? '✓' : '✕'} {c.label}
              </li>
            ))}
          </ul>
          {data.status === 'verified' &&
            data.orders.map((o) => (
              <article className="escrow-proof-order" key={o.id}>
                <div className="escrow-card-title">
                  <strong>On-chain status: {o.state}</strong>
                  <strong>{testEth(o.amountWei)}</strong>
                </div>
                <p>
                  Held for this order: {testEth(o.heldWei)} · Current wallet license:{' '}
                  {o.licenseActive ? 'active' : 'inactive'}
                </p>
                {['funded', 'delivered', 'disputed'].includes(o.state) && (
                  <p>
                    No revenue from this order has been released to the seller, co-authors or
                    platform.
                  </p>
                )}
                <details>
                  <summary>Deposit and settlement transactions</summary>
                  <p>
                    Deposit · block {o.block}: <code>{o.depositHash}</code>
                  </p>
                  {o.releaseHash && (
                    <p>
                      Release: <code>{o.releaseHash}</code>
                    </p>
                  )}
                  {o.refundHash && (
                    <p>
                      Refund credited: <code>{o.refundHash}</code>
                    </p>
                  )}
                  <p>
                    Order: <code>{o.id}</code>
                  </p>
                  <p>
                    Buyer: <code>{o.buyer}</code>
                  </p>
                  <p>
                    Seller: <code>{o.seller}</code>
                  </p>
                  <p>Buyer’s available refund balance: {testEth(o.refundBalanceWei)}</p>
                </details>
                {o.allocations.length > 0 && (
                  <details>
                    <summary>Revenue allocations at release</summary>
                    <ul>
                      {o.allocations.map((a, i) => (
                        <li key={i}>
                          <code>{a.wallet}</code> · {testEth(a.amountWei)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {o.withdrawals.length > 0 && (
                  <details>
                    <summary>Confirmed withdrawals (recent 5,000 blocks)</summary>
                    <p className="field-hint">
                      A withdrawal can combine credits from several orders.
                    </p>
                    <ul>
                      {o.withdrawals.map((w, i) => (
                        <li key={i}>
                          <code>{w.wallet}</code> · {testEth(w.amountWei)}
                          <p>
                            Transaction: <code>{w.hash}</code>
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}
        </>
      )}
      <p className="field-hint">
        Source: Anvil JSON-RPC. Escrow deposit, license release and withdrawal are different
        transactions.
      </p>
    </section>
  );
}
