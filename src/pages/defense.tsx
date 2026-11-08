import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Play, ShieldCheck, Check, Terminal, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui';
import { EscrowProof } from '../components/escrow-proof';
import type { DefenseState } from '../../shared/defense';
import './defense.css';

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const ease = (p: number) => p * p * p * (p * (p * 6 - 15) + 10);
async function command(path: string, data = {}) {
  const response = await fetch('/api/defense/' + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-ArtGuard-Defense': '1' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The live command failed.');
  return result;
}
export default function Defense() {
  const [params] = useSearchParams();
  const [view, setView] = useState<'intro' | 'deployment' | 'site' | 'proof' | 'tests' | 'done'>(
    'intro',
  );
  const [title, setTitle] = useState('ArtGuard · real local-network demonstration');
  const [caption, setCaption] = useState(
    'Deploy a smart contract, buy a license, release escrow and verify a co-author payout.',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [review, setReview] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null),
    pointer = useRef<HTMLDivElement>(null);
  const active = useRef(false),
    position = useRef({ x: 1680, y: 800 });
  const query = useQuery({
    queryKey: ['defense-state'],
    queryFn: () => api<DefenseState>('/defense/state'),
    refetchInterval: 800,
    retry: false,
  });
  const state = query.data;
  const completed = state?.events.some((e) => e.channel === 'stage' && e.text === 'Completed');
  async function current() {
    return api<DefenseState>('/defense/state');
  }
  async function until<T>(
    read: () => T | Promise<T>,
    label: string,
    timeout = 30000,
  ): Promise<NonNullable<T>> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = await read();
      if (value) return value as NonNullable<T>;
      await sleep(180);
    }
    throw new Error('Waiting for ' + label + ' timed out. No success is assumed.');
  }
  function documentForFrame() {
    return iframe.current?.contentDocument || null;
  }
  function visible(el: HTMLElement) {
    return !!el.getClientRects().length && !el.hidden;
  }
  function find(
    text: string | RegExp,
    selector = 'button,a,summary',
    doc: Document = documentForFrame()!,
  ) {
    if (!doc) return null;
    return (
      Array.from(doc.querySelectorAll<HTMLElement>(selector)).find((el) => {
        const label = (el.getAttribute('aria-label') || el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        return (
          visible(el) &&
          !Boolean((el as HTMLButtonElement).disabled) &&
          (typeof text === 'string' ? label === text : text.test(label))
        );
      }) || null
    );
  }
  async function point(x: number, y: number) {
    const from = position.current,
      dx = x - from.x,
      dy = y - from.y;
    const length = Math.hypot(dx, dy),
      duration = Math.min(1050, 400 + length * 0.3);
    const started = performance.now();
    await new Promise<void>((done) => {
      function frame(now: number) {
        const t = Math.min(1, (now - started) / duration),
          p = ease(t);
        const bend = Math.sin(Math.PI * p) * Math.min(22, length * 0.025);
        const cx = from.x + dx * p - (length ? dy / length : 0) * bend;
        const cy = from.y + dy * p + (length ? dx / length : 0) * bend;
        if (pointer.current) pointer.current.style.transform = `translate3d(${cx}px,${cy}px,0)`;
        if (t < 1) requestAnimationFrame(frame);
        else {
          position.current = { x, y };
          done();
        }
      }
      requestAnimationFrame(frame);
    });
  }
  async function tap(text: string | RegExp, selector?: string, outer = false) {
    const el = await until(
      () => find(text, selector, outer ? document : documentForFrame()!),
      String(text),
    );
    const frameBox = outer ? null : iframe.current!.getBoundingClientRect();
    let rect = el.getBoundingClientRect();
    if (!outer && (rect.top < 25 || rect.bottom > frameBox!.height - 25)) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await sleep(650);
      rect = el.getBoundingClientRect();
    }
    if (outer && (rect.top < 70 || rect.bottom > window.innerHeight - 130)) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await sleep(650);
      rect = el.getBoundingClientRect();
    }
    const x = (frameBox?.left || 0) + rect.left + rect.width / 2,
      y = (frameBox?.top || 0) + rect.top + rect.height / 2;
    await point(x, y);
    await sleep(230);
    pointer.current?.animate([{ scale: 1 }, { scale: 0.92 }, { scale: 1 }], { duration: 190 });
    el.click();
    await sleep(420);
  }
  async function stage(name: string, text: string, nextView: typeof view = 'site') {
    setTitle(name);
    setCaption(text);
    setView(nextView);
    await command('stage', { name });
    await sleep(650);
  }
  async function open(role: 'buyer' | 'creator' | 'coauthor', path: string) {
    iframe.current!.src = `/?demo=${role}#/` + path.replace(/^\//, '');
    const expected =
      role === 'coauthor' ? 'Demo Coauthor' : role === 'creator' ? 'Demo Creator' : 'Demo Buyer';
    await until(
      () =>
        documentForFrame()
          ?.querySelector('.profile-button strong')
          ?.textContent?.includes(expected),
      role + ' workspace',
    );
    await sleep(1100);
  }
  async function run() {
    if (active.current || !state?.enabled) return;
    active.current = true;
    setBusy(true);
    setError('');
    const started = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    try {
      setView('deployment');
      setTitle('01 · Deploy contracts and launch real checks');
      setCaption(
        'These commands run now. Solidity contracts deploy to Anvil, chain 31337. Selected unit and escrow tests run independently.',
      );
      await command('start');
      const ready = await until(
        async () => {
          const s = await current();
          if (s.phase === 'failed') throw new Error(s.error);
          return s.phase === 'ready' ? s : null;
        },
        'fresh deployment and demo setup',
        150000,
      );
      await sleep(5500);
      await stage(
        '02 · Find the project',
        'The buyer opens the real Marketplace. The project is already registered with its file and terms fingerprints.',
      );
      await open('buyer', 'marketplace');
      await sleep(1800);
      await tap(/Shared Horizons/, 'a');
      await sleep(2400);
      await stage(
        '03 · Connect and review the offer',
        'The demo buyer wallet connects on the local test chain. This is the site’s actual checkout component.',
      );
      await tap('Get this license');
      await sleep(1700);
      await tap('Continue to payment');
      await until(
        () => documentForFrame()?.querySelector('.check-label input[type="checkbox"]'),
        'quoted terms',
      );
      await sleep(1800);
      await tap('', '.blockchain-checkout .check-label input[type="checkbox"]');
      await stage(
        '04 · Deposit into escrow',
        'The buyer signs a real buyLicenses transaction. The contract checks the buyer, signed offer, fingerprints, amount and expiry.',
      );
      await tap(/^Pay [\d.]+ test ETH$/);
      await until(() => find('Open escrow orders'), 'confirmed escrow deposit', 45000);
      await sleep(2200);
      await tap('Open escrow orders');
      await stage(
        '05 · Creator confirms delivery',
        'Payment is held in the contract. No license or co-author revenue exists yet. The creator confirms delivery.',
      );
      await open('creator', 'escrow');
      await sleep(1000);
      await tap('Confirm file delivery');
      await until(
        () => documentForFrame()?.body.textContent?.includes('Ready for your review'),
        'delivery transaction',
      );
      await sleep(1700);
      await stage(
        '06 · Buyer accepts and releases payment',
        'Acceptance is another real transaction. It starts the license and allocates platform, creator and co-author credits.',
      );
      await open('buyer', 'escrow');
      await tap('Accept & release payment');
      await until(
        () => documentForFrame()?.body.textContent?.includes('Completed · license issued'),
        'release transaction',
      );
      await sleep(1600);
      await stage(
        '07 · The purchased license',
        'The real Licenses page now contains the buyer’s rights and protected original download. Copyright stays with the creator.',
      );
      iframe.current!.contentWindow!.location.hash = '/licenses';
      await until(() => find('License document'), 'issued license');
      await sleep(4200);
      await stage(
        '08 · Creator earnings',
        'Free plan commission is 10%. The remaining amount is shared 75/25. These amounts are read from the contract.',
      );
      await open('creator', 'profile/wallet');
      await until(() => find('Withdraw test earnings'), 'creator contract credit');
      await sleep(3500);
      await stage(
        '09 · Co-author withdraws',
        'The co-author signs withdraw with their own test wallet. Contract credit becomes a wallet transfer; gas is separate.',
      );
      await open('coauthor', 'profile/wallet');
      await sleep(1300);
      await tap('Withdraw test earnings');
      await until(
        () => documentForFrame()?.body.textContent?.includes('Test earnings withdrawn'),
        'co-author withdrawal',
      );
      await sleep(2200);
      await stage(
        '10 · Verify directly from the EVM',
        'This is the site’s real verification component. It reads receipts, canonical blocks, contract events, license state and withdrawals without a purchase database record.',
        'proof',
      );
      await tap('Verify escrow', undefined, true);
      await until(() => document.querySelector('.escrow-proof-order'), 'live EVM proof');
      await tap('Deposit and settlement transactions', 'summary', true);
      await sleep(3500);
      await tap('Confirmed withdrawals (recent 5,000 blocks)', 'summary', true);
      await sleep(3500);
      await command('evidence');
      await stage(
        '11 · Actual test results',
        'These are the fresh commands started at the beginning of this run. Counts and exit codes come from the real test processes.',
        'tests',
      );
      await until(
        async () => {
          const s = await current();
          const jobs = Object.values(s.jobs);
          return jobs.length === 2 && jobs.every((j) => j.status !== 'running') ? s : null;
        },
        'unit and EVM test processes',
        150000,
      );
      const checked = await current();
      if (Object.values(checked.jobs).some((j) => j.status !== 'passed'))
        throw new Error('A test process failed. The demonstration is not marked successful.');
      await sleep(8500);
      setView('done');
      setTitle('ArtGuard · verified on a local blockchain');
      setCaption(
        'Contract deployed. License purchased through escrow. Co-author paid. Selected unit and EVM tests passed.',
      );
      await command('stage', { name: 'Completed' });
      await sleep(5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Demonstration failed.');
    } finally {
      window.clearInterval(timer);
      setBusy(false);
    }
  }
  useEffect(() => {
    if (params.get('record') !== '1' || !state?.enabled || state.phase !== 'idle') return;
    const timer = window.setTimeout(() => void run(), 10000);
    return () => window.clearTimeout(timer);
  }, [state?.enabled, params.get('record')]);
  const jobs = Object.entries(state?.jobs || {});
  async function reviewPage(
    target: typeof view,
    role?: 'buyer' | 'creator' | 'coauthor',
    path?: string,
  ) {
    setError('');
    setView(target);
    setTitle('Review this run · current local EVM and saved command output');
    setCaption(
      'Inspect the actual deployment, order, license, wallet and saved test output. Opening a review does not launch another test or purchase.',
    );
    if (role && path) {
      try {
        await open(role, path);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not open the workspace.');
      }
    }
  }
  return (
    <div className={'defense-page ' + (review ? 'defense-reviewing' : '')}>
      <header className="defense-top">
        <Link to="/home">
          <ShieldCheck size={22} />
          artguard.
        </Link>
        <span>TEAM 03 · LIVE PROTOTYPE DEMO</span>
        <span className="defense-live">LOCAL EVM · TEST ETH ONLY</span>
        <small>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </small>
      </header>
      {review && (
        <nav className="defense-review" aria-label="Review actual run">
          <Button onClick={() => void reviewPage('deployment')}>Deployment</Button>
          <Button onClick={() => void reviewPage('site', 'buyer', 'escrow')}>
            Completed purchase
          </Button>
          <Button onClick={() => void reviewPage('site', 'buyer', 'licenses')}>License</Button>
          <Button onClick={() => void reviewPage('site', 'creator', 'profile/wallet')}>
            Creator wallet
          </Button>
          <Button onClick={() => void reviewPage('site', 'coauthor', 'profile/wallet')}>
            Co-author wallet
          </Button>
          <Button onClick={() => void reviewPage('proof')}>EVM proof</Button>
          <Button onClick={() => void reviewPage('tests')}>Test results</Button>
        </nav>
      )}
      <div className={'defense-stage ' + (view === 'site' ? 'defense-show-site' : '')}>
        <iframe
          ref={iframe}
          src="/#/home"
          title="Actual ArtGuard application"
          className={view === 'site' ? '' : 'defense-frame-hidden'}
        />
        {view === 'intro' && (
          <section className="defense-intro panel">
            <span className="eyebrow">WORKING PROTOTYPE · NO SIMULATED PAYMENTS</span>
            <h1>
              From original artwork
              <br />
              to a verified license.
            </h1>
            <p>The same ArtGuard interface. Real transactions on a local Anvil EVM.</p>
            <div className="defense-intro-points">
              <span>01 Deploy</span>
              <span>02 Buy & release escrow</span>
              <span>03 Pay co-authors</span>
              <span>04 Verify & test</span>
            </div>
            {state?.phase === 'idle' ? (
              <Button
                className="primary"
                disabled={!state?.enabled || busy}
                onClick={() => void run()}
              >
                <Play size={17} /> Start real demonstration
              </Button>
            ) : state?.phase === 'ready' ? (
              <Button
                className="primary"
                onClick={() => {
                  setReview(true);
                  void reviewPage('deployment');
                }}
              >
                <Play size={17} /> {completed ? 'Review this verified run' : 'Inspect current run'}
              </Button>
            ) : null}
            {!state?.enabled && (
              <p className="muted">
                Run <code>npm run demo:defense</code> locally to enable this isolated teaching
                instance. Command execution is disabled on shared servers.
              </p>
            )}
          </section>
        )}
        {view === 'deployment' && (
          <section className="defense-technical">
            <div className="defense-section-heading">
              <span className="eyebrow">
                REAL EXECUTION ·{' '}
                {state?.startedAt && new Date(state.startedAt).toLocaleTimeString('en-GB')}
              </span>
              <h1>Deploying smart contracts</h1>
              <p>
                Anvil EVM · Chain 31337 · compiler output → deployment receipt → runtime bytecode
              </p>
            </div>
            <div className="defense-deploy-grid">
              <article className="panel defense-console">
                <h3>
                  <Terminal size={18} /> Live command output
                </h3>
                <pre>
                  {state?.events
                    .filter((e) => ['deploy', 'setup'].includes(e.channel))
                    .slice(-12)
                    .map((e) => e.text)
                    .join('\n') || 'Starting the real local command…'}
                </pre>
              </article>
              <div className="defense-contracts">
                {state?.contracts.map((c) => (
                  <article className="panel" key={c.address}>
                    <h3>
                      <Check size={18} />
                      {c.name}
                    </h3>
                    <p>
                      Receipt status: success · Block {c.block} · Runtime{' '}
                      {c.bytecodeBytes.toLocaleString()} bytes
                    </p>
                    <label>Contract address</label>
                    <code>{c.address}</code>
                    <label>Deployment transaction</label>
                    <code>{c.hash}</code>
                  </article>
                ))}
              </div>
            </div>
            <div className="defense-job-strip">
              {jobs.map(([key, j]) => (
                <article className="panel" key={key}>
                  <code>$ {j.command}</code>
                  <span>
                    {j.status === 'running'
                      ? 'Running in parallel…'
                      : `${j.passed} passed · ${j.failed} failed · exit ${j.exitCode}`}
                  </span>
                </article>
              ))}
            </div>
          </section>
        )}
        {view === 'proof' && (
          <div className="defense-proof">
            <EscrowProof />
          </div>
        )}
        {view === 'tests' && (
          <section className="defense-technical">
            <div className="defense-section-heading">
              <span className="eyebrow">FRESH TEST PROCESSES · THIS RUN</span>
              <h1>Unit tests and smart-contract checks</h1>
              <p>
                Selected purchase, license, revenue and escrow suites. Results below are live
                process output.
              </p>
            </div>
            <div className="defense-test-grid">
              {jobs.map(([key, j]) => (
                <article className="panel defense-console" key={key}>
                  <h3>
                    {key === 'unit'
                      ? 'Application unit tests'
                      : 'Smart contract / EVM escrow tests'}
                  </h3>
                  <code className="defense-test-command">$ {j.command}</code>
                  <pre>{j.lines.slice(-12).join('\n') || 'Command launched; awaiting output…'}</pre>
                  <div className={'defense-test-result ' + j.status}>
                    {j.status === 'running' ? (
                      'Still running…'
                    ) : (
                      <>
                        <strong>{j.passed} passed</strong>
                        <span>
                          {j.failed} failed · process exit {j.exitCode}
                        </span>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {view === 'done' && (
          <section className="defense-intro panel defense-complete">
            <ShieldCheck size={52} />
            <span className="eyebrow">TEAM 03 · ARTGUARD</span>
            <h1>
              A purchase you can
              <br />
              verify on-chain.
            </h1>
            <p>
              Real deployment, real escrow payment, real license and a separate co-author
              withdrawal.
            </p>
            <div className="defense-intro-points">
              {[
                'Deployment verified',
                'License active',
                'Withdrawal verified',
                'Selected tests passed',
              ].map((t) => (
                <span key={t}>
                  <Check size={17} />
                  {t}
                </span>
              ))}
            </div>
            <Link to="/blockchain-demo" className="button">
              <ExternalLink size={16} /> Open blockchain lab
            </Link>
          </section>
        )}
        {error && (
          <div className="defense-error" role="alert">
            <strong>Demonstration stopped</strong>
            <p>{error}</p>
          </div>
        )}
      </div>
      <footer className="defense-caption">
        <strong>{title}</strong>
        <p>{caption}</p>
      </footer>
      <div
        ref={pointer}
        className="defense-pointer"
        style={{ visibility: busy ? 'visible' : 'hidden' }}
        aria-hidden="true"
      >
        <svg width="24" height="32" viewBox="0 0 24 32">
          <path
            d="M2 1V25L8 19L13 30L17 28L12 17H22Z"
            fill="#fff"
            stroke="#222"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
