import { useState } from 'react';
import { Button } from './ui';
import { Select } from './select';

const stages = [
  [
    'Create a project',
    'The server keeps the original file and calculates SHA-256 from its bytes. The same bytes always produce the same fingerprint.',
  ],
  [
    'Connect the creator wallet',
    'In the real app the wallet signs a one-time SIWE challenge. The server verifies the signature and links the address to the account. Signing in with Google does not prove wallet ownership.',
  ],
  [
    'Register the fingerprint',
    'The creator signs a registration transaction. The registry stores the file fingerprint, creator address, terms fingerprint and block time. The file itself stays off-chain.',
  ],
  [
    'Connect the buyer wallet',
    'The buyer proves control of a different wallet with a new SIWE challenge. The license will belong to the address that sends the purchase transaction.',
  ],
  [
    'Prepare a signed offer',
    'The server checks availability and co-author approvals, then signs the buyer, seller, file hash, terms, price, fee, recipients and license period. The payment quote lasts 10 minutes.',
  ],
  [
    'Confirm the purchase',
    'The contract verifies the platform signature, sending wallet, registration, quote deadline, license status and exact payment. All license and balance updates happen in one atomic transaction.',
  ],
  [
    'Verify the receipt',
    'The server reads the successful receipt and its contract events, then stores an accounting copy and unlocks the document and original file. The period begins at the mined block time.',
  ],
  [
    'Withdraw a co-author share',
    'The co-author signs withdraw(). The contract transfers that caller’s credit to their wallet and clears their available credit. Other recipients keep their balances.',
  ],
];
const sample = new TextEncoder().encode('ArtGuard teaching sample — a collaborative artwork');
const creator = '0x3C44…93BC',
  buyer = '0x90F7…b906',
  coauthor = '0x15d3…6A65';
export function BlockchainSandbox() {
  const [step, setStep] = useState(0),
    [fingerprint, setFingerprint] = useState(''),
    [filename, setFilename] = useState('Teaching sample'),
    [days, setDays] = useState('30'),
    [tamper, setTamper] = useState(false),
    [wrongWallet, setWrongWallet] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [purchasedAt, setPurchasedAt] = useState(''),
    [withdrawn, setWithdrawn] = useState(false);
  async function hash(bytes: Uint8Array<ArrayBuffer>) {
    setBusy(true);
    setError('');
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      setFingerprint(
        Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
      );
    } catch {
      setError('The browser could not calculate this fingerprint.');
    } finally {
      setBusy(false);
    }
  }
  const paid = step >= 6,
    connected = step >= 2,
    buyerConnected = step >= 4,
    registered = step >= 3,
    quoted = step >= 5;
  function next() {
    setError('');
    if (step === 0 && !fingerprint) {
      setError('Calculate the fingerprint first.');
      return;
    }
    if (step === 5 && (tamper || wrongWallet)) {
      setError(
        tamper
          ? 'Rejected: changing the price invalidates the signature. No license or balances were changed.'
          : 'Rejected: the sending wallet differs from the signed buyer. No license or balances were changed.',
      );
      return;
    }
    if (step === 5) setPurchasedAt(new Date().toISOString());
    if (step === 7) {
      setWithdrawn(true);
      return;
    }
    setStep(step + 1);
  }
  function reset() {
    setStep(0);
    setFingerprint('');
    setFilename('Teaching sample');
    setPurchasedAt('');
    setWithdrawn(false);
    setTamper(false);
    setWrongWallet(false);
    setError('');
  }
  const until =
    purchasedAt && days !== '0'
      ? new Date(Date.parse(purchasedAt) + Number(days) * 86400000).toLocaleString()
      : null;
  return (
    <section className="panel blockchain-sandbox" aria-labelledby="sandbox-title">
      <div className="chain-demo-section-heading">
        <h2 id="sandbox-title">Interactive practice</h2>
        <span>Simulation · no real transactions or wallet requests</span>
      </div>
      <div className="sandbox-progress" aria-label="Practice progress">
        {stages.map(([title], i) => (
          <span key={title} className={i === step ? 'current' : i < step ? 'complete' : ''}>
            {i + 1}
          </span>
        ))}
      </div>
      <div className="sandbox-layout">
        <div className="sandbox-action">
          <span className="eyebrow">
            Step {step + 1} of {stages.length}
          </span>
          <h3>{stages[step][0]}</h3>
          <p>{stages[step][1]}</p>
          {step === 0 && (
            <>
              <label className="field-label" htmlFor="sandbox-file">
                Optional local file
              </label>
              <input
                id="sandbox-file"
                type="file"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 20 * 1024 * 1024) {
                    setError('Choose a file up to 20 MB.');
                    return;
                  }
                  setFilename(file.name);
                  setFingerprint('');
                  await hash(new Uint8Array(await file.arrayBuffer()));
                }}
              />
              <p className="field-hint">
                The chosen file is hashed in this browser and is not uploaded.
              </p>
              <Button
                busy={busy}
                onClick={() => {
                  setFilename('Teaching sample');
                  void hash(sample);
                }}
              >
                Calculate sample fingerprint
              </Button>
              <label className="field-label" htmlFor="sandbox-duration">
                Author’s license period
              </label>
              <Select
                id="sandbox-duration"
                value={days}
                onChange={setDays}
                options={[
                  { value: '30', label: '30 days' },
                  { value: '90', label: '90 days' },
                  { value: '365', label: '1 year' },
                  { value: '0', label: 'Perpetual' },
                ]}
              />
            </>
          )}
          {step === 5 && (
            <div className="sandbox-faults">
              <label>
                <input
                  type="checkbox"
                  checked={tamper}
                  onChange={(e) => {
                    setTamper(e.target.checked);
                    setError('');
                  }}
                />
                Change the signed price
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={wrongWallet}
                  onChange={(e) => {
                    setWrongWallet(e.target.checked);
                    setError('');
                  }}
                />
                Send from a different wallet
              </label>
              <small>Try an invalid purchase, then clear the checkboxes to continue.</small>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {withdrawn && (
            <p role="status" className="local-note">
              Simulation complete. The purchase and co-author withdrawal are separate transactions.
              Check an actual transaction in the RPC verification panel below.
            </p>
          )}
          <div className="actions">
            <Button className="primary" disabled={busy || withdrawn} onClick={next}>
              {
                [
                  'Keep project and continue',
                  'Sign creator challenge',
                  'Record registration',
                  'Sign buyer challenge',
                  'Sign offer',
                  'Confirm simulated payment',
                  'Read verified license',
                  'Withdraw simulated share',
                ][step]
              }
            </Button>
            <Button onClick={reset}>Reset practice</Button>
          </div>
        </div>
        <div className="sandbox-state" aria-live="polite">
          <article>
            <h4>ArtGuard server</h4>
            <p>File: {fingerprint ? filename : 'Not uploaded'}</p>
            <p>Account: buys and creates projects</p>
            <p>Offer: {quoted ? 'Signed · 0.012 test ETH' : 'Not prepared'}</p>
            <p>Purchase copy: {step >= 7 ? 'Verified receipt saved' : 'Not confirmed'}</p>
          </article>
          <article>
            <h4>Wallets</h4>
            <p>Creator: {connected ? creator : 'Not connected'}</p>
            <p>Buyer: {buyerConnected ? buyer : 'Not connected'}</p>
            <p>Co-author: {coauthor} · 25% of net</p>
            <p>Withdrawal: {withdrawn ? '0.0027 test ETH received' : 'Not sent'}</p>
          </article>
          <article>
            <h4>Blockchain</h4>
            <p>Registration: {registered ? 'Fingerprint + creator wallet' : 'Not recorded'}</p>
            <p>License: {paid ? `Assigned to ${buyer}` : 'Not issued'}</p>
            {paid && <p>Until: {until || 'Perpetual'}</p>}
            <p>
              Credits:{' '}
              {paid
                ? `Creator 0.0081 · co-author ${withdrawn ? '0' : '0.0027'} · platform 0.0012 test ETH`
                : '0 test ETH'}
            </p>
          </article>
          <details>
            <summary>File fingerprint</summary>
            <code className="hash">{fingerprint || 'Calculate a fingerprint at step 1.'}</code>
            <p className="field-hint">
              SHA-256 identifies these exact bytes. It does not by itself prove who created the
              work. Quote and terms hashes use Ethereum’s keccak256.
            </p>
          </details>
        </div>
      </div>
      <details className="sandbox-escrow">
        <summary>Is this escrow?</summary>
        <p>
          This practice illustrates earlier direct payments. There is no waiting for buyer
          acceptance in this earlier flow; credits become withdrawable immediately. New purchases
          use the escrow contract shown below: funds are held through delivery and review, with
          disputes and full refunds available under its rules.
        </p>
      </details>
    </section>
  );
}
