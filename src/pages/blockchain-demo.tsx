import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  FileCheck2,
  Fingerprint,
  Monitor,
  ShieldCheck,
  Split,
  Wallet,
  Workflow,
} from 'lucide-react';
import { useData } from '../lib/workspace';
import { Button, PageHeading } from '../components/ui';
import { BlockchainProof } from '../components/blockchain-proof';
import { EscrowProof } from '../components/escrow-proof';
import { BlockchainSandbox } from '../components/blockchain-sandbox';

const steps = [
  {
    title: 'Register the work',
    short: 'Register',
    Icon: Fingerprint,
    layer: 'Creator → blockchain',
    description:
      'The creator uploads an original file. ArtGuard calculates its digital fingerprint, and the creator records that fingerprint with their wallet.',
    facts: [
      'The file stays on the server.',
      'The registry stores its SHA-256 fingerprint, wallet and time.',
      'This records a claim about the file; it does not independently prove authorship.',
    ],
    takeaway:
      'A blockchain record connects a particular file fingerprint with the wallet that registered it.',
  },
  {
    title: 'Prepare the purchase',
    short: 'Prepare',
    Icon: FileCheck2,
    layer: 'ArtGuard server',
    description:
      'The buyer chooses a license. The server prepares a signed offer containing the price, commission, buyer, creator and co-author shares.',
    facts: [
      'Each co-author approves the current split before new quotes.',
      'The offer is signed with EIP-712 and expires after 10 minutes.',
      'Changing the signed amount or recipients invalidates the signature.',
    ],
    takeaway:
      'The signature lets the contract check that it received the exact offer prepared by ArtGuard.',
  },
  {
    title: 'Deposit into escrow',
    short: 'Deposit',
    Icon: Wallet,
    layer: 'Buyer → smart contract',
    description:
      'The buyer sends the signed offer and the exact test ETH amount to the escrow contract. The deposit holds the payment without issuing a license or allocating revenue.',
    facts: [
      'The contract checks the signature, buyer, expiry and file registration.',
      'Replayed offers, duplicate pending orders and an active license for the same wallet are rejected.',
      'A failed transaction rolls back the purchase; network gas is separate.',
    ],
    takeaway:
      'A button click is not proof of payment. The transaction must succeed on the blockchain.',
  },
  {
    title: 'Confirm and review delivery',
    short: 'Review',
    Icon: Split,
    layer: 'Creator and buyer → escrow contract',
    description:
      'The creator has 72 hours to confirm delivery on-chain. The buyer then has 24 hours to accept or dispute. This step keeps the payment locked.',
    facts: [
      'Without delivery, a refund becomes available after 72 hours.',
      'A dispute blocks ordinary release. The trusted platform arbiter can release or refund.',
      'After 7 days without a dispute decision, a refund becomes available. Timers never send transactions themselves.',
    ],
    takeaway:
      'Delivery, acceptance and a refund are separate actions with their own on-chain conditions.',
  },
  {
    title: 'Release payment and activate the license',
    short: 'Release',
    Icon: ShieldCheck,
    layer: 'Blockchain → ArtGuard server',
    description:
      'Buyer acceptance releases the payment, starts the wallet-bound license and allocates the commission and co-author credits. After the review deadline, anyone can submit the release transaction if the order is not disputed.',
    facts: [
      'The creator plan sets a 10%, 5% or 0% commission. Co-author shares divide the remainder.',
      'The server checks the release receipt and events before saving the purchase and unlocking the original file.',
      'Deposit and release have different transaction hashes. The license period starts on release.',
    ],
    takeaway:
      'The blockchain records the purchase; the server provides the document and access to the file.',
  },
  {
    title: 'Withdraw the earnings',
    short: 'Withdraw',
    Icon: Wallet,
    layer: 'Smart contract → recipient wallet',
    description:
      'The creator and each co-author can withdraw their own accumulated credit. Each withdrawal is a separate transaction authorized by that recipient’s wallet.',
    facts: [
      'Release credits balances inside the contract. A deposit alone earns no withdrawable proceeds.',
      'withdraw() sends the caller’s available credit to their wallet.',
      'Withdrawing changes the available balance, while the original sale remains in history.',
    ],
    takeaway:
      'Allocation and withdrawal are separate actions: earning a share does not immediately transfer it to the external wallet.',
  },
];
export default function BlockchainDemonstration() {
  const { user } = useData();
  const allowed = !!user?.isAdmin && user.emailVerified;
  const [step, setStep] = useState(0),
    [presentation, setPresentation] = useState(false),
    [legacyProofOpen, setLegacyProofOpen] = useState(false);
  useEffect(() => {
    if (!presentation) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresentation(false);
    };
    document.addEventListener('keydown', exit);
    return () => document.removeEventListener('keydown', exit);
  }, [presentation]);
  const current = steps[step];
  return (
    <div className={'blockchain-demo' + (presentation ? ' is-presenting' : '')}>
      <PageHeading
        kicker={
          allowed
            ? 'Administration · technology walkthrough'
            : 'Technology walkthrough · no account required'
        }
        title="How ArtGuard uses blockchain"
        description="Follow one license purchase, from the original file to the creator’s earnings."
        action={
          <div className="actions">
            <Link className="button primary" to="/presentation">
              <Monitor size={16} /> Guided demo
            </Link>
            <Button aria-pressed={presentation} onClick={() => setPresentation(!presentation)}>
              <Monitor size={16} />
              {presentation ? 'Exit presentation' : 'Presentation view'}
            </Button>
          </div>
        }
      />
      <section className="chain-demo-walkthrough" aria-labelledby="chain-demo-flow-title">
        <div className="panel escrow-lifecycle">
          <h2>New purchases use escrow</h2>
          <ol>
            <li>
              <strong>Deposit</strong>
              <span>
                The buyer pays the contract. Funds are held; no license or revenue credit is issued.
              </span>
            </li>
            <li>
              <strong>Delivery · 72 hours</strong>
              <span>
                The seller confirms the file is ready. Without delivery, a full refund becomes
                available.
              </span>
            </li>
            <li>
              <strong>Review · 24 hours</strong>
              <span>
                The buyer inspects the file and accepts, or opens a dispute. After the review
                deadline, anyone can submit a release transaction for an undisputed order.
              </span>
            </li>
            <li>
              <strong>Dispute · 7 days</strong>
              <span>
                A manager acts through the platform arbiter to release or refund. If no decision
                arrives, a refund becomes available.
              </span>
            </li>
            <li>
              <strong>Settlement</strong>
              <span>
                Release starts the license and credits the seller, co-authors and commission. A
                refund credits the buyer’s separate refund balance. Each recipient withdraws with
                their own wallet.
              </span>
            </li>
          </ol>
          <p className="field-hint">
            Timers enable actions. They do not send transactions by themselves. The platform arbiter
            is a trusted dispute resolver in this local prototype.
          </p>
        </div>
        <div className="chain-demo-section-heading">
          <h2 id="chain-demo-flow-title">The current escrow license flow</h2>
          <span>Illustrated walkthrough · no transactions are sent</span>
        </div>
        <nav className="chain-demo-flow" aria-label="Blockchain walkthrough steps">
          {steps.map(({ short, Icon }, index) => (
            <button
              key={short}
              className={'chain-demo-node' + (index === step ? ' active' : '')}
              aria-current={index === step ? 'step' : undefined}
              aria-controls="chain-demo-step"
              onClick={() => setStep(index)}
            >
              <span className="chain-demo-step-number">
                {index < step ? <Check size={13} /> : index + 1}
              </span>
              <Icon size={23} strokeWidth={1.5} />
              <span>{short}</span>
              <ArrowRight className="chain-demo-connector" size={15} aria-hidden="true" />
            </button>
          ))}
        </nav>
        <div
          id="chain-demo-step"
          className="panel chain-demo-step"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="chain-demo-step-copy">
            <span className="eyebrow">
              Step {step + 1} of {steps.length} · {current.layer}
            </span>
            <h3>{current.title}</h3>
            <p>{current.description}</p>
            <blockquote>{current.takeaway}</blockquote>
          </div>
          <ul>
            {current.facts.map((fact) => (
              <li key={fact}>
                <Check size={15} />
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="chain-demo-controls">
          <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
            <ArrowLeft size={15} />
            Previous
          </Button>
          <span>
            {step + 1} / {steps.length}
          </span>
          <Button
            className="primary"
            onClick={() => setStep(step === steps.length - 1 ? 0 : step + 1)}
          >
            {step === steps.length - 1 ? 'Start again' : 'Next step'}
            <ArrowRight size={15} />
          </Button>
        </div>
      </section>

      {allowed && <BlockchainSandbox />}
      <EscrowProof />
      <details
        className="panel chain-demo-boundary"
        onToggle={(event) => setLegacyProofOpen(event.currentTarget.open)}
      >
        <summary>Earlier direct-payment purchases</summary>
        <p className="field-hint">
          This separate archive checks older v2/v3 purchases. Current v4 escrow orders use the
          escrow verification above. An empty archive does not mean an escrow payment failed.
        </p>
        {legacyProofOpen && <BlockchainProof />}
      </details>

      <details className="panel chain-demo-boundary">
        <summary>
          <Database size={18} />
          What is stored where?
        </summary>
        <div className="chain-demo-boundary-grid">
          <div>
            <h3>On the blockchain</h3>
            <p>
              File fingerprints and registration claims, license ownership, payment events, revenue
              credits and withdrawals.
            </p>
          </div>
          <div>
            <h3>On the ArtGuard server</h3>
            <p>
              Accounts, uploaded files, project descriptions, co-author approvals, signed offers,
              license documents and accounting copies.
            </p>
          </div>
        </div>
        <p className="chain-demo-caption">
          The platform prepares signed offers and controls access to stored files. This is a local
          prototype with one Anvil node; it has no public-network decentralization or NFT tokens.
        </p>
      </details>
      <details className="panel chain-demo-guide">
        <summary>
          <Workflow size={18} />A short script for your presentation
        </summary>
        <ol>
          <li>
            Use the six steps above to explain what the creator, buyer, server and contract each do.
          </li>
          <li>
            Use the public verification panel to show a real transaction, its block and the revenue
            allocation events. Expand wallet credits to distinguish allocations from withdrawals.
          </li>
          <li>
            {allowed
              ? 'Open Demo studio in the normal view to show the buyer, creator and co-author in separate windows.'
              : 'Use the withdrawal step to explain how each creator controls their own earnings with their wallet.'}
          </li>
          <li>
            {allowed
              ? 'Show the existing license and each recipient’s Wallet. A real purchase or withdrawal must be confirmed separately in that account.'
              : 'Finish with “What is stored where?” to explain the roles of the blockchain and the ArtGuard server.'}
          </li>
        </ol>
        <div className="actions">
          {allowed ? (
            <>
              <Link className="button subtle" to="/demo">
                Open demo accounts
                <ArrowRight size={15} />
              </Link>
              <Link className="button subtle" to="/admin/technical">
                Technical administration
                <Database size={15} />
              </Link>
            </>
          ) : (
            <Link className="button subtle" to="/marketplace">
              Explore marketplace
              <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </details>
    </div>
  );
}
