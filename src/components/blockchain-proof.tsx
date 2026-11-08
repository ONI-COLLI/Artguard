import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleAlert, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { PublicChainProof } from '../../shared/public-chain-proof';
import { testEth } from '../../shared/marketplace';
import { api } from '../lib/api';
import { Button } from './ui';
import { CopyValue } from './payment-receipt';

export function BlockchainProof() {
  const [input, setInput] = useState(''),
    [hash, setHash] = useState(''),
    [inputError, setInputError] = useState('');
  const query = useQuery({
    queryKey: ['public-blockchain-proof', hash],
    queryFn: ({ signal }) =>
      api<PublicChainProof>(
        '/blockchain/demo-proof' + (hash ? '?transactionHash=' + encodeURIComponent(hash) : ''),
        { signal },
      ),
    retry: false,
    staleTime: 10_000,
  });
  const data = query.data,
    transaction = data?.transaction;
  const current = !query.isFetching && !query.isError;
  const verified = current && data?.status === 'verified';
  function verify(event: FormEvent) {
    event.preventDefault();
    const next = input.trim().toLowerCase();
    if (next && !/^0x[\da-f]{64}$/.test(next)) {
      setInputError(
        'Enter a transaction hash starting with 0x followed by 64 hexadecimal characters.',
      );
      return;
    }
    setInputError('');
    if (next === hash) void query.refetch();
    else setHash(next);
  }
  function latest() {
    setInput('');
    setInputError('');
    if (!hash) void query.refetch();
    else setHash('');
  }
  return (
    <section
      className="panel chain-demo-payment public-chain-proof"
      aria-labelledby="public-chain-proof-title"
    >
      <div className="chain-demo-section-heading">
        <div>
          <span className="eyebrow">Live evidence · no account required</span>
          <h2 id="public-chain-proof-title">Verify a real blockchain purchase</h2>
          <p>Read the transaction, license and revenue events directly from the local EVM node.</p>
        </div>
        <Button busy={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw size={15} />
          Refresh proof
        </Button>
      </div>
      <form className="chain-proof-form" onSubmit={verify}>
        <label htmlFor="chain-proof-hash">Transaction hash</label>
        <div>
          <input
            id="chain-proof-hash"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setInputError('');
            }}
            placeholder="Paste a hash, or use the latest license purchase"
            aria-invalid={!!inputError}
            aria-describedby={inputError ? 'chain-proof-error' : 'chain-proof-input-hint'}
            maxLength={100}
            spellCheck={false}
            autoComplete="off"
          />
          <Button type="submit" className="primary" disabled={query.isFetching}>
            <Search size={15} />
            Verify transaction
          </Button>
          <Button type="button" disabled={query.isFetching} onClick={latest}>
            Latest purchase
          </Button>
        </div>
        {inputError ? (
          <p id="chain-proof-error" className="form-error" role="alert">
            {inputError}
          </p>
        ) : (
          <p id="chain-proof-input-hint">
            The latest purchase loads automatically. This check reads the blockchain without sending
            a transaction.
          </p>
        )}
      </form>
      <div className="chain-demo-context">
        <span>
          <span className={'chain-demo-dot' + (verified ? ' connected' : '')} />
          {query.isFetching
            ? 'Checking Anvil RPC…'
            : query.isError
              ? 'Could not refresh live proof'
              : data?.status === 'verified'
                ? 'Verified directly on the local chain'
                : 'Live verification not confirmed'}
        </span>
        <span>
          Chain {data?.chainId ?? 31337}
          {data?.headBlock && ` · Latest block ${data.headBlock}`}
        </span>
        <span>Test ETH · no monetary value</span>
      </div>
      {query.isError ? (
        <p className="form-error" role="alert">
          {query.error.message}{' '}
          {data && 'The result below belongs to the previous check; refresh to verify again.'}
        </p>
      ) : current && data && data.status !== 'verified' ? (
        <p className="local-note" role="status">
          {data.message}
        </p>
      ) : null}
      {data && (
        <ul
          className={'chain-proof-checks' + (!current ? ' previous-check' : '')}
          aria-label="Blockchain verification checks"
        >
          {data.checks.map((check) => (
            <li key={check.id} className={check.passed ? 'passed' : 'failed'}>
              {check.passed ? <Check size={15} /> : <CircleAlert size={15} />}
              <span>{check.label}</span>
            </li>
          ))}
        </ul>
      )}
      {transaction && (
        <>
          <div className="chain-proof-transaction">
            <div>
              <span className="eyebrow">
                {verified ? 'Verified payment' : 'Previous check'} · Block {transaction.blockNumber}
              </span>
              <CopyValue value={transaction.hash} label="Transaction hash" />
              <p>
                {transaction.licenses.length}{' '}
                {transaction.licenses.length === 1 ? 'license' : 'licenses'} ·{' '}
                {transaction.licenses.every((license) => license.owned)
                  ? 'Wallet license currently active'
                  : 'Purchase recorded · license period ended'}
              </p>
            </div>
            <div className="chain-demo-payment-total">
              <span>Buyer paid</span>
              <strong>{testEth(transaction.amountWei)}</strong>
              <small>Gas paid separately: {testEth(transaction.gasWei)}</small>
            </div>
          </div>
          <h3 className="chain-proof-subtitle">Revenue allocated by this transaction</h3>
          <div className="chain-demo-allocation">
            {transaction.allocations.map((allocation, index) => (
              <div key={index}>
                <span>
                  {allocation.role === 'Platform'
                    ? 'Platform commission'
                    : allocation.role + ' credit'}
                </span>
                <strong>{testEth(allocation.amountWei)}</strong>
                <small title={allocation.wallet}>
                  {allocation.wallet.slice(0, 8)}…{allocation.wallet.slice(-6)}
                </small>
              </div>
            ))}
          </div>
          <p className="chain-demo-caption">
            These amounts are confirmed by the contract’s payment and RevenueAllocated events. They
            are credits inside the contract; withdrawal is a separate transaction.
          </p>
          <details className="chain-demo-details">
            <summary>Wallet credits & confirmed withdrawals</summary>
            <p className="chain-demo-caption">
              Contract credits at block {data?.headBlock}. A withdrawal can combine earnings from
              multiple purchases.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Available in contract</th>
                    <th>Wallet</th>
                  </tr>
                </thead>
                <tbody>
                  {transaction.credits.map((credit) => (
                    <tr key={credit.wallet}>
                      <td>
                        {[
                          ...new Set(
                            transaction.allocations
                              .filter(
                                (allocation) =>
                                  allocation.wallet.toLowerCase() === credit.wallet.toLowerCase(),
                              )
                              .map((allocation) => allocation.role),
                          ),
                        ].join(' / ')}
                      </td>
                      <td>
                        {credit.amountWei === null ? 'Unavailable' : testEth(credit.amountWei)}
                      </td>
                      <td>
                        <CopyValue value={credit.wallet} label="Recipient wallet" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {transaction.withdrawalScan === 'unavailable' ? (
              <p className="local-note">
                Withdrawal history could not be checked. No withdrawal result is claimed.
              </p>
            ) : transaction.withdrawals.length === 0 ? (
              <p className="local-note">
                No withdrawal was recorded for these wallets from block{' '}
                {transaction.withdrawalsFromBlock} to {data?.headBlock}. Revenue has been allocated;
                this is not evidence of a transfer to an external wallet.
              </p>
            ) : (
              <div className="chain-proof-withdrawals">
                {transaction.withdrawals.map((withdrawal, index) => (
                  <article key={index}>
                    <span>
                      <ShieldCheck size={15} />
                      Confirmed withdrawal · Block {withdrawal.blockNumber}
                    </span>
                    <strong>{testEth(withdrawal.amountWei)}</strong>
                    <CopyValue value={withdrawal.wallet} label="Withdrawal recipient" />
                    <CopyValue value={withdrawal.transactionHash} label="Withdrawal transaction" />
                  </article>
                ))}
              </div>
            )}
            {transaction.withdrawalScan === 'recent' && (
              <p className="chain-demo-caption">
                Showing up to 20 recent withdrawals from block {transaction.withdrawalsFromBlock};
                earlier history is not included.
              </p>
            )}
          </details>
          <details className="chain-demo-details">
            <summary>RPC receipt, block & contract evidence</summary>
            <dl className="chain-demo-records">
              <div>
                <dt>Data source</dt>
                <dd>Anvil JSON-RPC · {data?.rpcUrl} · verification uses no accounting database</dd>
              </div>
              <div>
                <dt>Block hash</dt>
                <dd>
                  <CopyValue value={transaction.blockHash} label="Block hash" />
                </dd>
              </div>
              <div>
                <dt>Contract</dt>
                <dd>
                  <CopyValue value={transaction.contract} label="Payment contract" />
                </dd>
              </div>
              <div>
                <dt>Buyer wallet</dt>
                <dd>
                  <CopyValue value={transaction.buyer} label="Buyer wallet" />
                </dd>
              </div>
              <div>
                <dt>Checked at</dt>
                <dd>
                  <time dateTime={data?.checkedAt}>
                    {data?.checkedAt && new Date(data.checkedAt).toLocaleString('en-GB')}
                  </time>
                  {!current && ' · previous result'}
                </dd>
              </div>
            </dl>
            <p className="chain-demo-caption">
              Checks use eth_getTransactionReceipt, eth_getTransactionByHash, eth_getBlockByHash,
              eth_getBlockByNumber, eth_getCode, eth_call and eth_getLogs.
            </p>
            <pre className="chain-proof-json">{JSON.stringify(transaction.receipt, null, 2)}</pre>
            <p className="chain-demo-caption">
              Receipt fields are read from RPC and displayed in hexadecimal where applicable. This
              is a local Anvil transaction with test ETH.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
