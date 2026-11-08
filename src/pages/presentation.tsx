import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Split,
  Wallet,
} from 'lucide-react';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { testEth } from '../../shared/marketplace';
import { shortAddress } from '../../shared/blockchain';
import type { PresentationEvidence } from '../../shared/presentation';
import type { EscrowProof } from '../../shared/escrow-proof';
import './presentation.css';

export const chapters = [
  {
    short: 'ArtGuard',
    title: 'Original work. Clear licenses.',
    seconds: 10,
    caption:
      'A creator publishes a project. A buyer chooses usage rights. Escrow protects the payment, and co-authors receive their agreed shares.',
  },
  {
    short: 'Deployment',
    title: 'The contract is already on the EVM.',
    seconds: 18,
    caption:
      'Solidity is compiled and deployed to Anvil. This view reads the current deployment receipt, canonical block and bytecode. It does not deploy a new contract.',
  },
  {
    short: 'File fingerprint',
    title: 'A fingerprint connects the file to its record.',
    seconds: 16,
    caption:
      'SHA-256 is calculated from the original bytes. The file stays on the server; its fingerprint, terms fingerprint and registering wallet are recorded on-chain. This records a claim, not proof of authorship.',
  },
  {
    short: 'Wallets',
    title: 'An account and a wallet have different jobs.',
    seconds: 12,
    caption:
      'The account opens your workspace. A one-time SIWE signature proves control of a wallet. Linking a wallet does not authorize a payment.',
  },
  {
    short: 'Checkout',
    title: 'The buyer reviews a signed offer.',
    seconds: 18,
    caption:
      'The server signs the buyer, seller, file, terms, price, fee, shares and period using EIP-712. The contract checks that exact offer and the sending wallet.',
  },
  {
    short: 'Escrow',
    title: 'Payment is held until delivery and review.',
    seconds: 16,
    caption:
      'The deposit issues no license or revenue credit. The seller has 72 hours to confirm delivery; the buyer then has 24 hours to accept or dispute.',
  },
  {
    short: 'License',
    title: 'Acceptance releases payment and starts the license.',
    seconds: 14,
    caption:
      'After a successful release transaction, the buyer wallet holds the license. ArtGuard verifies the receipt before unlocking the document and original file.',
  },
  {
    short: 'Revenue split',
    title: 'Every share is calculated in the contract.',
    seconds: 18,
    caption:
      'In this example the Free plan takes 10%. The creator receives 75% of the remaining amount, and the co-author receives 25%. These are contract credits, not wallet transfers.',
  },
  {
    short: 'Withdrawal',
    title: 'The co-author withdraws with their own wallet.',
    seconds: 14,
    caption:
      'Withdraw is a separate signed transaction. The contract clears that recipient’s credit and transfers it to their wallet. Network gas is separate.',
  },
  {
    short: 'Live proof',
    title: 'Verify the transaction against the blockchain.',
    seconds: 18,
    caption:
      'This read-only check uses the local EVM, without an account or database purchase record. Deposit, release and withdrawal have different transaction hashes.',
  },
  {
    short: 'Tests',
    title: 'Show the test command and its recorded result.',
    seconds: 16,
    caption:
      'These are saved command results with timestamps and log fingerprints. Opening this page does not run tests. Missing results are never replaced with invented passes.',
  },
] as const;
const totalSeconds = chapters.reduce((sum, item) => sum + item.seconds, 0);
const date = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    timeZone: 'Asia/Qyzylorda',
    dateStyle: 'medium',
    timeStyle: 'short',
  }) + ' (UTC+5)';

function Tile({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <article className="tour-tile">
      <div className="tour-tile-title">
        {icon}
        {title}
      </div>
      {children}
    </article>
  );
}
function ProjectArt() {
  return (
    <div
      className="tour-art"
      role="img"
      aria-label="Illustrative geometric artwork with an orange circle and architectural shapes"
    >
      <i />
      <i />
      <i />
      <span>ARTGUARD · PREVIEW</span>
    </div>
  );
}
function TransactionDetails({ label, hash }: { label: string; hash: string }) {
  return (
    <details className="tour-details">
      <summary>
        {label} <span>{shortAddress(hash)}</span>
      </summary>
      <code>{hash}</code>
    </details>
  );
}

export default function Presentation() {
  const [query] = useSearchParams();
  const recording = query.get('record') === '1';
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false),
    [focus, setFocus] = useState(recording),
    [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  useEffect(() => {
    if (!recording) return;
    const timer = window.setTimeout(() => setPlaying(true), 10000);
    return () => window.clearTimeout(timer);
  }, [recording]);
  const [sample, setSample] = useState('ArtGuard — Shared Horizons — original project bytes'),
    [digest, setDigest] = useState<{ source: string; value: string } | null>(null),
    [hashing, setHashing] = useState(false),
    [hashError, setHashError] = useState('');
  const [tampered, setTampered] = useState(false),
    [withdrawn, setWithdrawn] = useState(false);
  const evidence = useQuery({
    queryKey: ['presentation-evidence'],
    queryFn: () => api<PresentationEvidence>('/blockchain/presentation'),
    retry: false,
  });
  const proof = useQuery({
    queryKey: ['escrow-proof', 'presentation'],
    queryFn: () => api<EscrowProof>('/blockchain/escrow-proof'),
    retry: false,
  });
  const [hashInput, setHashInput] = useState(''),
    [hashValidation, setHashValidation] = useState('');
  const [selectedProof, setSelectedProof] = useState<EscrowProof | null>(null),
    [verifying, setVerifying] = useState(false),
    [proofError, setProofError] = useState('');
  const chapter = chapters[step];
  const evidenceData = evidence.error ? undefined : evidence.data;
  const liveProof =
    proofError || verifying || proof.isFetching
      ? null
      : selectedProof || (proof.error ? undefined : proof.data);
  const verified = liveProof?.status === 'verified' && liveProof.checks.every((c) => c.passed);
  const order = verified ? liveProof.orders[0] : undefined;
  const prior = chapters.slice(0, step).reduce((sum, item) => sum + item.seconds, 0);

  function go(index: number) {
    setStep(Math.max(0, Math.min(chapters.length - 1, index)));
    elapsedRef.current = 0;
    setElapsed(0);
    setPlaying(false);
  }
  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now() - elapsedRef.current * 1000;
    const timer = window.setInterval(() => {
      elapsedRef.current = (performance.now() - startedAt) / 1000;
      if (elapsedRef.current >= chapters[step].seconds) {
        if (step === chapters.length - 1) {
          elapsedRef.current = chapters[step].seconds;
          setElapsed(elapsedRef.current);
          setPlaying(false);
        } else {
          elapsedRef.current = 0;
          setElapsed(0);
          setStep(step + 1);
        }
      } else setElapsed(elapsedRef.current);
    }, 100);
    const hidden = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [playing, step]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      if (event.key === 'Escape') {
        setFocus(false);
        setPlaying(false);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(step + 1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(step - 1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step]);
  async function calculate() {
    setHashing(true);
    setHashError('');
    const source = sample;
    try {
      const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
      setDigest({
        source,
        value: Array.from(new Uint8Array(value), (n) => n.toString(16).padStart(2, '0')).join(''),
      });
    } catch {
      setHashError('Fingerprint calculation is unavailable in this browser.');
    } finally {
      setHashing(false);
    }
  }
  useEffect(() => {
    if (step === 2) void calculate();
  }, [step]);
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (hashInput.trim() && !/^0x[\da-fA-F]{64}$/.test(hashInput.trim())) {
      setHashValidation(
        'Enter a complete transaction hash: 0x followed by 64 hexadecimal characters.',
      );
      return;
    }
    setHashValidation('');
    setProofError('');
    setSelectedProof(null);
    setVerifying(true);
    try {
      setSelectedProof(
        await api<EscrowProof>(
          '/blockchain/escrow-proof' +
            (hashInput.trim() ? '?transactionHash=' + encodeURIComponent(hashInput.trim()) : ''),
        ),
      );
    } catch (error) {
      setProofError(error instanceof Error ? error.message : 'Verification could not finish.');
    } finally {
      setVerifying(false);
    }
  }
  function start() {
    if (step === chapters.length - 1 && elapsed >= chapter.seconds) {
      elapsedRef.current = 0;
      setElapsed(0);
      setStep(0);
    }
    setPlaying(!playing);
  }
  const illustrated = step !== 1 && step !== 9 && step !== 10 && step !== 0;
  return (
    <div className={'site-presentation' + (focus ? ' tour-focus' : '')}>
      <header className="tour-header">
        <div>
          <span className="eyebrow">Team 03 · ArtGuard demonstration</span>
          <h1>From artwork to on-chain license.</h1>
          <p className="muted">
            A guided tour inside ArtGuard · English explanations · no sign-in required
          </p>
        </div>
        <div className="actions">
          <Button aria-pressed={focus} onClick={() => setFocus(!focus)}>
            {focus ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {focus ? 'Exit focus view' : 'Focus view'}
          </Button>
          <Link className="button subtle" to="/demo">
            Demo accounts <ExternalLink size={14} />
          </Link>
        </div>
      </header>
      <div className="tour-layout">
        <nav className="tour-chapters" aria-label="Guided demo chapters">
          {chapters.map((item, index) => (
            <button
              key={item.short}
              aria-current={index === step ? 'step' : undefined}
              onClick={() => go(index)}
            >
              <span>{index < step ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span>
              {item.short}
            </button>
          ))}
        </nav>
        <section className="tour-stage" aria-label="Demonstration stage">
          <div className="tour-stage-heading">
            <span className="eyebrow">
              Step {step + 1} / {chapters.length}
            </span>
            <span className="tour-source">
              {illustrated
                ? 'Interactive illustration · no transactions sent'
                : step === 10
                  ? 'Recorded command results'
                  : step === 0
                    ? 'Local prototype · test ETH only'
                    : 'Live read-only EVM evidence'}
            </span>
          </div>
          <div className="tour-scene" key={step}>
            <h2 tabIndex={-1}>{chapter.title}</h2>
            <div className="tour-visual">
              {step === 0 && (
                <div className="tour-intro">
                  <div>
                    <ShieldCheck size={40} strokeWidth={1.3} />
                    <h3>
                      Create.
                      <br />
                      <em>License.</em>
                      <br />
                      Share the proceeds.
                    </h3>
                    <div className="tour-role-pills">
                      <span>Creator</span>
                      <ArrowRight size={15} />
                      <span>Escrow</span>
                      <ArrowRight size={15} />
                      <span>Buyer</span>
                    </div>
                  </div>
                  <div className="tour-project">
                    <ProjectArt />
                    <h3>Shared Horizons</h3>
                    <p className="muted">
                      One collaborative project. One complete licensing journey.
                    </p>
                  </div>
                </div>
              )}
              {step === 1 && (
                <>
                  <div className="tour-command">
                    <Code2 size={17} />
                    <code>npm run chain</code>
                    <span>Deployment command · shown for reference</span>
                  </div>
                  {evidence.isPending && <p role="status">Reading current deployment receipts…</p>}
                  <div className="tour-two-columns">
                    {evidenceData?.contracts.map((contract) => (
                      <Tile
                        key={contract.address}
                        title={contract.name}
                        icon={<ShieldCheck size={20} />}
                      >
                        <strong className="tour-value">
                          {evidence.isFetching
                            ? 'Checking…'
                            : contract.verified
                              ? 'Deployed & verified'
                              : 'Not verified'}
                        </strong>
                        <p className="muted">
                          Block {contract.block || 'unavailable'} ·{' '}
                          {contract.bytecodeBytes.toLocaleString('en-US')} bytes of runtime code
                        </p>
                        <code className="tour-address">{contract.address}</code>
                        <TransactionDetails
                          label="Deployment transaction"
                          hash={contract.transactionHash}
                        />
                      </Tile>
                    ))}
                  </div>
                  <p
                    className={evidence.error || !evidenceData?.online ? 'tour-notice' : 'muted'}
                    role="status"
                  >
                    {evidence.error?.message || evidenceData?.message}
                  </p>
                  <Button busy={evidence.isFetching} onClick={() => void evidence.refetch()}>
                    <RefreshCw size={14} />
                    Check deployment again
                  </Button>
                </>
              )}
              {step === 2 && (
                <div className="tour-two-columns">
                  <Tile title="Original file stays on the server" icon={<Fingerprint size={20} />}>
                    <label htmlFor="tour-bytes">Try changing the example bytes</label>
                    <textarea
                      id="tour-bytes"
                      rows={3}
                      value={sample}
                      onChange={(e) => setSample(e.target.value)}
                    />
                    <Button className="primary" busy={hashing} onClick={() => void calculate()}>
                      Calculate SHA-256
                    </Button>
                    <p className="field-hint">
                      Calculated locally in your browser. Nothing is uploaded or registered.
                    </p>
                  </Tile>
                  <Tile title="Digital fingerprint" icon={<LockKeyhole size={20} />}>
                    <p className="tour-hash" role="status">
                      {digest?.source === sample
                        ? digest.value
                        : 'Calculate the fingerprint to see the exact 64-character result.'}
                    </p>
                    <p className="muted">
                      In the actual registry this fingerprint is stored together with the creator
                      wallet and the usage terms fingerprint.
                    </p>
                    {hashError && <p role="alert">{hashError}</p>}
                  </Tile>
                </div>
              )}
              {step === 3 && (
                <div className="tour-three-columns">
                  {['Creator', 'Buyer', 'Co-author'].map((role, i) => (
                    <Tile key={role} title={role} icon={<Wallet size={22} />}>
                      <span className="tour-avatar">{role[0]}</span>
                      <strong className="tour-value">Own wallet</strong>
                      <p className="muted">
                        {i === 0
                          ? 'Registers the work and confirms delivery.'
                          : i === 1
                            ? 'Funds escrow and receives the license.'
                            : 'Approves the split and withdraws earnings.'}
                      </p>
                      <span className="tour-status">
                        <Check size={14} />
                        SIWE ownership proof
                      </span>
                    </Tile>
                  ))}
                </div>
              )}
              {step === 4 && (
                <div className="tour-checkout">
                  <div className="tour-project">
                    <ProjectArt />
                    <h3>Shared Horizons</h3>
                    <p className="muted">Personal license · perpetual</p>
                  </div>
                  <Tile title="Get a license" icon={<FileCheck2 size={20} />}>
                    <strong className="tour-price">
                      {tampered ? '0.001' : '0.012'} <small>test ETH</small>
                    </strong>
                    <ul className="tour-check-list">
                      <li>
                        <Check size={15} />
                        Buyer wallet must match the signed buyer
                      </li>
                      <li>
                        <Check size={15} />
                        Registered file and usage terms must match
                      </li>
                      <li>
                        <Check size={15} />
                        Exact payment and an unexpired, unused quote
                      </li>
                    </ul>
                    <Button className="primary full" disabled={tampered} onClick={() => go(5)}>
                      Show escrow deposit <ArrowRight size={15} />
                    </Button>
                    <Button className="text-button" onClick={() => setTampered(!tampered)}>
                      {tampered ? 'Restore the signed price' : 'Try changing the signed price'}
                    </Button>
                    {tampered && (
                      <p className="tour-rejected" role="alert">
                        Rejected: payment differs from the signed offer. No transaction was sent.
                      </p>
                    )}
                  </Tile>
                </div>
              )}
              {step === 5 && (
                <>
                  <div className="tour-escrow">
                    <div>
                      <Wallet size={27} />
                      <span>Buyer wallet</span>
                    </div>
                    <span className="tour-transfer" aria-hidden="true">
                      <i />
                    </span>
                    <div className="tour-vault">
                      <LockKeyhole size={36} />
                      <strong>0.012 test ETH</strong>
                      <span>Held in escrow</span>
                    </div>
                    <span className="tour-transfer" aria-hidden="true" />
                    <div className="tour-locked">
                      <ShieldCheck size={27} />
                      <span>License not issued</span>
                    </div>
                  </div>
                  <div className="tour-three-columns">
                    <Tile title="01 · Delivery">
                      <strong className="tour-value">72 hours</strong>
                      <p className="muted">The seller confirms the file is ready.</p>
                    </Tile>
                    <Tile title="02 · Review">
                      <strong className="tour-value">24 hours</strong>
                      <p className="muted">The buyer accepts or opens a dispute.</p>
                    </Tile>
                    <Tile title="03 · If disputed">
                      <strong className="tour-value">7 days</strong>
                      <p className="muted">
                        A trusted platform arbiter decides release or refund. Missed deadlines
                        permit a refund transaction.
                      </p>
                    </Tile>
                  </div>
                  <p className="field-hint">
                    Timers enable actions. A wallet still has to send the transaction.
                  </p>
                </>
              )}
              {step === 6 && (
                <div className="tour-two-columns">
                  <Tile title="Buyer accepts delivery" icon={<ShieldCheck size={24} />}>
                    <div className="tour-license">
                      <Check size={34} />
                      <h3>License issued on release</h3>
                      <p>Shared Horizons · Personal · Perpetual</p>
                      <span>Assigned to the buyer wallet</span>
                    </div>
                    <p className="muted">
                      The release transaction creates the license and allocates the payment
                      atomically.
                    </p>
                  </Tile>
                  <Tile title="Your licenses" icon={<FileCheck2 size={22} />}>
                    <div className="tour-mini-art">
                      <ProjectArt />
                      <div>
                        <h3>Shared Horizons</h3>
                        <p className="muted">Payment verified</p>
                      </div>
                    </div>
                    <div className="tour-document">
                      <FileCheck2 size={20} />
                      <span>License document unlocked</span>
                      <Check size={16} />
                    </div>
                    <div className="tour-document">
                      <LockKeyhole size={20} />
                      <span>Original file unlocked</span>
                      <Check size={16} />
                    </div>
                    <p className="field-hint">
                      Usage rights are licensed. Copyright stays with the creator.
                    </p>
                  </Tile>
                </div>
              )}
              {step === 7 && (
                <div className="tour-split">
                  <div className="tour-split-total">
                    <span>License payment</span>
                    <strong>
                      0.012 <small>test ETH</small>
                    </strong>
                    <span>Illustrated Free-plan example</span>
                  </div>
                  {[
                    { role: 'Platform', rule: '10% of the payment', value: '0.0012', fraction: 10 },
                    {
                      role: 'Creator',
                      rule: '75% of net proceeds',
                      value: '0.0081',
                      fraction: 67.5,
                    },
                    {
                      role: 'Co-author',
                      rule: '25% of net proceeds',
                      value: '0.0027',
                      fraction: 22.5,
                    },
                  ].map((row) => (
                    <div className="tour-split-row" key={row.role}>
                      <div>
                        <strong>{row.role}</strong>
                        <span>{row.rule}</span>
                      </div>
                      <div className="tour-split-track">
                        <i style={{ width: row.fraction + '%' }} />
                      </div>
                      <strong>
                        {row.value} <small>test ETH</small>
                      </strong>
                    </div>
                  ))}
                  <p className="tour-notice">
                    <Split size={17} />
                    Available inside the contract. Each recipient withdraws separately.
                  </p>
                </div>
              )}
              {step === 8 && (
                <div className="tour-two-columns">
                  <Tile title="Co-author earnings" icon={<Split size={20} />}>
                    <span className="muted">Available contract credit</span>
                    <strong className="tour-price">
                      {withdrawn ? '0' : '0.0027'} <small>test ETH</small>
                    </strong>
                    <Button
                      className="primary full"
                      disabled={withdrawn}
                      onClick={() => setWithdrawn(true)}
                    >
                      Simulate withdrawal <ArrowRight size={15} />
                    </Button>
                    <p className="field-hint">
                      Illustration only. This button sends no blockchain transaction.
                    </p>
                  </Tile>
                  <Tile title="Co-author wallet" icon={<Wallet size={22} />}>
                    <strong className="tour-value" role="status">
                      {withdrawn ? 'Share transferred' : 'Waiting for withdrawal'}
                    </strong>
                    <p>
                      {withdrawn
                        ? '0.0027 test ETH transferred before gas.'
                        : 'A revenue allocation is not yet a payment to this wallet.'}
                    </p>
                    <p className="muted">
                      The real withdrawal uses the co-author’s signature and produces its own
                      receipt.
                    </p>
                    {withdrawn && (
                      <Button className="text-button" onClick={() => setWithdrawn(false)}>
                        <RotateCcw size={14} />
                        Reset example
                      </Button>
                    )}
                  </Tile>
                </div>
              )}
              {step === 9 && (
                <>
                  <form className="tour-proof-form" onSubmit={(event) => void verify(event)}>
                    <label htmlFor="tour-proof-hash">
                      Deposit transaction hash · leave empty for the latest
                    </label>
                    <div>
                      <input
                        id="tour-proof-hash"
                        placeholder="0x…"
                        value={hashInput}
                        onChange={(event) => setHashInput(event.target.value)}
                      />
                      <Button
                        className="primary"
                        type="submit"
                        busy={verifying || proof.isFetching}
                      >
                        Verify on-chain
                      </Button>
                    </div>
                  </form>
                  {(hashValidation || proofError || (!selectedProof && proof.error)) && (
                    <p className="form-error" role="alert">
                      {hashValidation || proofError || proof.error?.message}
                    </p>
                  )}
                  {(verifying || proof.isFetching) && (
                    <p role="status">Reading receipts and current contract state…</p>
                  )}
                  {!verifying && !proof.isFetching && (
                    <p className="tour-proof-status" role="status">
                      {verified
                        ? 'Verified directly on the local EVM'
                        : liveProof?.message || 'No current blockchain proof is available.'}
                    </p>
                  )}
                  {order && (
                    <>
                      <div className="tour-three-columns">
                        <Tile title="Order state">
                          <strong className="tour-value">{order.state}</strong>
                          <p>{testEth(order.amountWei)}</p>
                        </Tile>
                        <Tile title="Held in escrow">
                          <strong className="tour-value">{testEth(order.heldWei)}</strong>
                          <p className="muted">Current contract state</p>
                        </Tile>
                        <Tile title="Wallet license">
                          <strong className="tour-value">
                            {order.licenseActive ? 'Active' : 'Inactive'}
                          </strong>
                          <code className="tour-address">{order.buyer}</code>
                        </Tile>
                      </div>
                      <div className="tour-receipts">
                        <TransactionDetails
                          label={'Deposit · block ' + order.block}
                          hash={order.depositHash}
                        />
                        {order.releaseHash && (
                          <TransactionDetails label="License release" hash={order.releaseHash} />
                        )}
                        {order.withdrawals.map((w) => (
                          <TransactionDetails
                            key={w.hash}
                            label={'Withdrawal · ' + testEth(w.amountWei)}
                            hash={w.hash}
                          />
                        ))}
                      </div>
                      <details className="tour-details">
                        <summary>{liveProof?.checks.length} verification checks</summary>
                        <ul className="tour-check-list">
                          {liveProof?.checks.map((check) => (
                            <li key={check.label}>
                              <Check size={14} />
                              {check.label}
                            </li>
                          ))}
                        </ul>
                      </details>
                      <p className="field-hint">
                        Checked {liveProof && date(liveProof.checkedAt)} · Anvil JSON-RPC · recent
                        5,000 blocks
                      </p>
                    </>
                  )}
                </>
              )}
              {step === 10 && (
                <>
                  <div className="tour-two-columns">
                    {evidenceData?.runs.map((run) => (
                      <Tile key={run.label} title={run.label} icon={<Code2 size={20} />}>
                        <code className="tour-run-command">{run.command}</code>
                        <strong className="tour-price">
                          {run.passed} <small>passed</small>
                        </strong>
                        <p>
                          {run.failed} failed · process exit code {run.exitCode}
                        </p>
                        <span
                          className={
                            run.exitCode === 0 && run.failed === 0 ? 'tour-status' : 'tour-rejected'
                          }
                        >
                          {run.exitCode === 0 && run.failed === 0
                            ? 'Recorded run passed'
                            : 'Recorded run failed'}
                        </span>
                        <p className="field-hint">Completed {date(run.completedAt)}</p>
                        <details className="tour-details">
                          <summary>Recorded log SHA-256</summary>
                          <code>{run.logSha256}</code>
                        </details>
                      </Tile>
                    ))}
                  </div>
                  {!evidenceData?.runs.length && (
                    <p className="tour-notice" role="status">
                      No valid recorded test results are available on this server.
                    </p>
                  )}
                  <p className="muted">
                    Historical evidence from saved command output. This is not a live terminal or a
                    test run for every subsequent code change.
                  </p>
                  <Link className="button" to="/blockchain-demo">
                    Open the detailed blockchain lab <ExternalLink size={14} />
                  </Link>
                </>
              )}
            </div>
          </div>
          <p className="tour-caption" aria-live="polite" aria-atomic="true">
            {chapter.caption}
          </p>
          <div
            className="tour-progress"
            role="progressbar"
            aria-label="Guided presentation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(((prior + elapsed) / totalSeconds) * 100)}
          >
            <span style={{ width: ((prior + elapsed) / totalSeconds) * 100 + '%' }} />
          </div>
          <div className="tour-controls">
            <Button disabled={step === 0} onClick={() => go(step - 1)}>
              <ArrowLeft size={16} />
              Previous
            </Button>
            <div>
              <Button
                className="primary"
                aria-label={playing ? 'Pause presentation' : 'Play presentation'}
                onClick={start}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
                {playing ? 'Pause' : 'Auto play'}
              </Button>
              <span>
                {Math.floor(totalSeconds / 60)}:{String(totalSeconds % 60).padStart(2, '0')} total ·{' '}
                {step + 1}/{chapters.length}
              </span>
            </div>
            <Button onClick={() => (step === chapters.length - 1 ? go(0) : go(step + 1))}>
              {step === chapters.length - 1 ? 'Start again' : 'Next step'}
              <ArrowRight size={16} />
            </Button>
          </div>
        </section>
      </div>
      <div className="tour-bottom">
        <span>← → to change steps · Esc to pause and exit focus view</span>
        <Link to="/blockchain-demo">
          Detailed verification & documentation <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
