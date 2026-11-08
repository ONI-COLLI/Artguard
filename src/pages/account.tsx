import { sessionUrl } from '../lib/session';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Plus, Download, Shield, Wallet, X } from 'lucide-react';
import { useData, useAction, useFeedback, useDownload, errorText } from '../lib/workspace';
import { useDialog, AccessPanel } from '../components/dialogs';
import { PageHeading, Form, Field, Submit, Button, date, Empty } from '../components/ui';
import { ChainAmount, useDisplayCurrency } from '../components/currency';
import { ArtworkTable } from '../components/artwork';
import { licenseTypes, profileSchema, teamSchema } from '../../shared/schemas';
import { Heatmap } from './overview';
import { WalletPanel } from '../components/wallet';
import { BlockchainCheckout, PendingBlockchainCheckouts } from '../components/blockchain-checkout';
import { MarketProceeds } from '../components/market-proceeds';
import { creatorCredit } from '../../shared/revenue';
import { Sharing } from '../components/revenue-sharing';
import { PaymentReceipt } from '../components/payment-receipt';
import { PlanCards, PlanPaymentNote } from '../components/plan-cards';
import { AccountMenu } from '../components/account-menu';
export function Works() {
  const d = useData();
  return (
    <>
      <PageHeading
        kicker="Your portfolio"
        title="Make room for your next idea."
        description="Publish, edit, and organize your creative work."
        action={
          <Link className="button primary" to="/upload">
            <Plus size={16} />
            Publish artwork
          </Link>
        }
      />
      {d.user ? (
        <>
          <div className="command-bar">
            {d.artworks.filter((a) => a.own).length} artworks · {d.plans[d.user.plan].name}{' '}
            workspace
          </div>
          <ArtworkTable items={d.artworks.filter((a) => a.own)} />
        </>
      ) : (
        <AccessPanel />
      )}
    </>
  );
}
function Bulk() {
  const { money } = useDisplayCurrency();
  const [paymentMode, setPaymentMode] = useState<'blockchain' | 'local'>('blockchain');
  const d = useData(),
    [ids, setIds] = useState<string[]>([]),
    action = useAction('/purchases'),
    dialog = useDialog(),
    navigate = useNavigate(),
    { notify } = useFeedback();
  const items = d.artworks.filter(
    (a) =>
      !a.own &&
      a.status === 'published' &&
      a.licenses.includes('commercial') &&
      !d.purchases.some((p) => p.artworkId === a.id && p.license === 'commercial' && !p.expired),
  );
  return (
    <>
      <p className="muted">Choose commercial licenses for your next project.</p>
      {action.isError && (
        <p className="form-error" role="alert">
          {errorText(action.error)}
        </p>
      )}
      {items.map((a) => (
        <label className="bulk-item" key={a.id}>
          <input
            type="checkbox"
            checked={ids.includes(a.id)}
            onChange={(e) =>
              setIds((v) => (e.target.checked ? [...v, a.id] : v.filter((id) => id !== a.id)))
            }
          />
          <img src={sessionUrl(a.image)} alt="" />
          <span>{a.title}</span>
          <strong>{money(a.price * 2.5)}</strong>
        </label>
      ))}
      <div className="checkout-row" role="status">
        {ids.length} licenses ·{' '}
        {money(items.filter((a) => ids.includes(a.id)).reduce((s, a) => s + a.price * 2.5, 0))}
      </div>
      <div className="segmented payment-modes">
        <button
          aria-pressed={paymentMode === 'blockchain'}
          className={paymentMode === 'blockchain' ? 'active' : ''}
          onClick={() => setPaymentMode('blockchain')}
        >
          Pay with test ETH
        </button>
        <button
          aria-pressed={paymentMode === 'local'}
          className={paymentMode === 'local' ? 'active' : ''}
          onClick={() => setPaymentMode('local')}
        >
          Local order
        </button>
      </div>
      {paymentMode === 'blockchain' ? (
        <BlockchainCheckout
          key={ids.slice().sort().join(',')}
          items={ids.map((artworkId) => ({ artworkId, license: 'commercial' }))}
        />
      ) : (
        <>
          <p className="muted small-text">No payment will be collected.</p>
          <Button
            className="primary full"
            disabled={!ids.length}
            busy={action.isPending}
            onClick={async () => {
              try {
                await action.mutateAsync({
                  items: ids.map((artworkId) => ({ artworkId, license: 'commercial' })),
                });
                dialog.close();
                navigate('/licenses');
                notify({
                  title: 'Your license package is ready',
                  detail: `${ids.length} commercial licenses added. No payment was collected.`,
                });
              } catch {
                /* visible above */
              }
            }}
          >
            Confirm local package
          </Button>
        </>
      )}
    </>
  );
}
export function Licenses() {
  const { money } = useDisplayCurrency();
  const d = useData(),
    dialog = useDialog(),
    download = useDownload();
  return (
    <>
      <PageHeading
        kicker="Your creative toolkit"
        title="Your licenses"
        description="Purchased usage rights and original files, ready to use."
        action={
          d.user?.plan === 'business' ? (
            <button
              className="primary"
              onClick={() => dialog.open('One package. More possibilities.', <Bulk />)}
            >
              <Plus size={16} />
              Build license package
            </button>
          ) : undefined
        }
      />
      {d.user && <PendingBlockchainCheckouts />}
      {d.user && (
        <p className="muted small-text">
          Waiting for delivery, acceptance or a refund?{' '}
          <Link to="/escrow">Open Orders & escrow →</Link>
        </p>
      )}
      {!d.user ? (
        <AccessPanel />
      ) : d.purchases.length ? (
        <>
          <div className="license-grid">
            {d.purchases.map((p) => {
              const a = d.artworks.find((a) => a.id === p.artworkId);
              return a ? (
                <article className="panel license-card" key={p.id}>
                  <Link
                    className="license-preview"
                    to={'/artwork/' + a.id}
                    aria-label={'View ' + a.title}
                  >
                    <img src={sessionUrl(a.image)} alt={a.title} />
                  </Link>
                  <div className="license-card-content">
                    <div className="license-card-heading">
                      <div>
                        <span className="license-status">
                          <Shield size={12} />
                          {p.expired ? 'Expired' : p.payment ? 'Payment verified' : 'Local license'}
                        </span>
                        <h2>
                          <Link to={'/artwork/' + a.id}>{a.title}</Link>
                        </h2>
                        <p className="license-meta">
                          {licenseTypes[p.license].title} license <span>·</span> {a.author}
                        </p>
                      </div>
                      <div className="license-purchase-meta">
                        <strong>
                          {p.payment ? <ChainAmount wei={p.payment.amountWei} /> : money(p.amount)}
                        </strong>
                        <time dateTime={p.createdAt}>{date(p.date)}</time>
                      </div>
                    </div>
                    <div className="actions license-actions">
                      <p className="muted small-text">
                        {p.validUntil ? `Valid until ${date(p.validUntil)}` : 'Perpetual license'}
                      </p>
                      {p.expired && (
                        <Link className="button small primary" to={'/artwork/' + a.id}>
                          Renew license
                        </Link>
                      )}
                      <Button
                        className="small"
                        busy={download.pending}
                        onClick={() => void download.run(`/api/licenses/${p.id}/document`)}
                      >
                        <Shield size={14} />
                        License document
                      </Button>
                      <Button
                        className="small"
                        busy={download.pending}
                        onClick={() => void download.run(`/api/artworks/${a.id}/download`)}
                        disabled={p.expired}
                      >
                        <Download size={14} />
                        Original file
                      </Button>
                    </div>
                    {p.payment && (
                      <PaymentReceipt
                        transactionHash={p.payment.transactionHash}
                        buyerWallet={p.payment.buyerWallet}
                        chainId={p.payment.chainId}
                        fundingHash={p.payment.escrow?.fundingTransactionHash}
                      />
                    )}
                  </div>
                </article>
              ) : null;
            })}
          </div>
        </>
      ) : (
        <Empty
          title="Your collection starts with a spark."
          description="Find something that belongs in your next project."
        />
      )}
    </>
  );
}
export function Analytics() {
  const { money } = useDisplayCurrency();
  const d = useData(),
    download = useDownload();
  if (!d.user)
    return (
      <>
        <PageHeading kicker="A clearer view" title="Every sale tells a story." />
        <AccessPanel />
      </>
    );
  const localSales = d.sales.filter((s) => !s.payment),
    gross = localSales.reduce((s, a) => s + a.amount, 0),
    net = localSales.reduce((s, a) => s + a.net, 0),
    chainNet = d.sales.reduce((sum, s) => sum + (s.payment ? creatorCredit(s.payment) : 0n), 0n);
  return (
    <>
      <PageHeading
        kicker="Studio insights"
        title="A little perspective. A lot of possibility."
        description="Your recorded sales and earnings, without the guesswork."
        action={
          d.user.plan === 'free' ? (
            <Link className="button" to="/pricing">
              Export report · Premium
            </Link>
          ) : (
            <Button busy={download.pending} onClick={() => void download.run('/api/sales/export')}>
              <Download size={16} />
              Export report
            </Button>
          )
        }
      />
      <div className="analytics-stats">
        {[
          ['Gross sales', money(gross)],
          ['Platform fees', money(gross - net)],
          ['Net recorded earnings', money(net)],
          ['Licenses sold', d.sales.length],
        ].map(([l, v]) => (
          <div className="panel metric" key={l}>
            <span>{l}</span>
            <strong>{v}</strong>
            <small>Local records · no real funds</small>
          </div>
        ))}
      </div>
      <div className="analytics-grid">
        <div className="panel blockchain-earnings">
          <h3>Blockchain test earnings</h3>
          <strong>
            <ChainAmount wei={chainNet} />
          </strong>
          <p className="small-text muted">
            Your creator share from verified local-chain sales. Co-author receipts appear below.
            Verified chain payments are shown separately from simulated local orders.
          </p>
          <MarketProceeds />
        </div>
        <Heatmap />
        <div className="panel revenue-panel">
          <div className="panel-heading">
            <h3>Project revenue sharing</h3>
          </div>
          <p className="muted small-text">
            Each project has its own co-authors and shares. Set them when uploading or editing.
            Shares apply after platform fees; paid licenses keep their saved allocation.
          </p>
          {d.artworks
            .filter((a) => a.own)
            .map((a) => (
              <div className="recipient" key={a.id}>
                <span>
                  <Link to={`/edit/${a.id}`}>{a.title}</Link>
                  <small className="muted split-wallet">
                    {a.recipients?.length || 0} co-authors · You keep{' '}
                    {100 - (a.recipients || []).reduce((sum, r) => sum + r.percent, 0)}%
                  </small>
                </span>
                <Link to={`/edit/${a.id}`} className="small-link">
                  Edit shares
                </Link>
              </div>
            ))}
          {!d.artworks.some((a) => a.own) && (
            <p className="small-text muted">
              Add co-authors in the upload form for your first project.
            </p>
          )}
          <Link className="button full" to="/works">
            Manage project shares
          </Link>
        </div>
      </div>
      <section className="recent-section">
        <h2>Sales history</h2>
        {d.sales.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {['Artwork', 'Buyer', 'License', 'Date', 'Gross', 'Fee', 'Net'].map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.sales.map((s) => (
                  <tr key={s.id}>
                    <td>{s.title}</td>
                    <td>{s.buyer}</td>
                    <td>{licenseTypes[s.license].title}</td>
                    <td>{date(s.date)}</td>
                    <td>
                      {s.payment ? <ChainAmount wei={s.payment.amountWei} /> : money(s.amount)}
                    </td>
                    <td>
                      {s.payment ? <ChainAmount wei={s.payment.feeWei} /> : money(s.commission)}
                    </td>
                    <td>
                      {s.payment ? <ChainAmount wei={creatorCredit(s.payment)} /> : money(s.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="The beginning of a good story."
            description="Publish artwork and your sales will appear here."
            to="/upload"
            label="Publish artwork"
          />
        )}
      </section>
    </>
  );
}
export function Profile() {
  const d = useData(),
    profile = useAction('/profile', 'PATCH'),
    addTeam = useAction('/team'),
    { notify } = useFeedback(),
    dialog = useDialog();
  if (!d.user)
    return (
      <>
        <PageHeading
          kicker="Your account"
          title="Profile"
          description="Sign in to manage your workspace and plan."
        />
        <AccessPanel />
        <section className="profile-plans">
          <h2>Find your plan</h2>
          <PlanCards />
          <PlanPaymentNote />
        </section>
      </>
    );
  const u = d.user;
  return (
    <>
      <PageHeading
        kicker="Your account"
        title="Profile"
        description={`${u.name} · ${u.email}`}
        action={
          <Button onClick={() => dialog.open('Your account', <AccountMenu />)}>
            Account actions
          </Button>
        }
      />
      <section className="profile-plans" aria-labelledby="profile-plans-title">
        <div className="profile-section-heading">
          <div>
            <h2 id="profile-plans-title">Your plan</h2>
            <p>Compare monthly price, sales commission and workspace features.</p>
          </div>
          <Link to="/billing">
            Manage billing <ArrowRight size={14} />
          </Link>
        </div>
        <PlanCards />
        <PlanPaymentNote />
      </section>
      <div className="profile-section-heading">
        <div>
          <h2>Account settings</h2>
          <p>Manage your details, wallet and upload preferences.</p>
        </div>
      </div>
      <div className="profile-details-layout">
        <Form
          className="panel form-panel"
          schema={profileSchema}
          warnUnsaved
          defaults={{ name: u.name, email: u.email, role: u.role }}
          onSubmit={async (v, form) => {
            await profile.mutateAsync(v);
            form.reset(v);
            notify({
              title: 'Profile saved',
              detail:
                'Your private account details were updated. Manage your public alias in Privacy.',
            });
          }}
        >
          <h3>Personal details</h3>
          <Link to="/privacy">Manage public alias, privacy & support →</Link>
          <Field name="name" label="Name / studio" maxLength={80} />
          <Field name="email" label="Email address" type="email" />
          <p className="field-hint">
            One account lets you buy licenses, publish projects and collaborate with other creators.
          </p>
          <Submit>
            Save profile <ArrowRight size={16} />
          </Submit>
        </Form>
        <div className="profile-details-side">
          <div className="panel profile-wallet-summary">
            <div>
              <Wallet size={19} />
              <div>
                <h3>Wallet</h3>
                <p>
                  {u.wallet
                    ? `Linked · ${u.wallet.address.slice(0, 6)}…${u.wallet.address.slice(-4)}`
                    : 'Connect your wallet to get started'}
                </p>
              </div>
            </div>
            <Link className="button full" to="/profile/wallet">
              Open wallet <ArrowRight size={14} />
            </Link>
          </div>
          {
            <details className="panel profile-detail-panel">
              <summary>
                <span>
                  Upload defaults<small>Co-author defaults for new projects</small>
                </span>
              </summary>
              <p className="muted small-text">
                Set a starting list of co-authors for new uploads. Each project keeps its own copy;
                changing defaults does not update existing projects.
              </p>
              <button className="full" onClick={() => dialog.open('Upload defaults', <Sharing />)}>
                Edit upload defaults
              </button>
            </details>
          }
          {u.plan === 'business' && (
            <div className="panel team-panel">
              <div className="panel-heading">
                <h3>Your team</h3>
                {u.plan === 'business' && (
                  <button
                    className="icon-button"
                    aria-label="Add team member"
                    onClick={() =>
                      dialog.open(
                        'Add someone to your circle.',
                        <>
                          <p className="muted small-text">
                            A local contact only. No invitation or shared account access.
                          </p>
                          <Form
                            schema={teamSchema}
                            onSubmit={async (v) => {
                              await addTeam.mutateAsync(v);
                              dialog.close();
                              notify({
                                title: 'Team contact added',
                                detail: 'No invitation was sent.',
                              });
                            }}
                          >
                            <Field name="name" label="Name" />
                            <Field name="email" label="Email" type="email" />
                            <Submit>Add team contact</Submit>
                          </Form>
                        </>,
                      )
                    }
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
              {u.plan === 'business' ? (
                <>
                  {d.team.length ? (
                    d.team.map((t) => (
                      <div className="team-member" key={t.id}>
                        <span className="avatar small">{t.name[0]}</span>
                        <div>
                          <strong>{t.name}</strong>
                          <small>{t.email}</small>
                        </div>
                        <RemoveMember id={t.id} name={t.name} />
                      </div>
                    ))
                  ) : (
                    <p className="muted small-text">Your team directory is empty.</p>
                  )}
                  <p className="small-text muted">
                    Local contacts only. Members do not receive account access.
                  </p>
                </>
              ) : (
                <Link to="/pricing">Team features are available on Business →</Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
export function ProfileWallet() {
  const { user } = useData();
  return (
    <>
      <PageHeading
        kicker="Your account"
        title="Wallet"
        description="Manage your wallet, test ETH balance and available payouts."
      />
      {user ? (
        <section className="panel profile-wallet-content" aria-label="Your wallet">
          <WalletPanel fullPage />
        </section>
      ) : (
        <AccessPanel />
      )}
    </>
  );
}
function RemoveMember({ id, name }: { id: string; name: string }) {
  const action = useAction(`/team/${id}`, 'DELETE'),
    { notify } = useFeedback();
  return (
    <Button
      className="icon-button small"
      aria-label={'Remove ' + name}
      busy={action.isPending}
      onClick={async () => {
        try {
          await action.mutateAsync({});
          notify({ title: 'Team contact removed' });
        } catch (e) {
          notify({ title: errorText(e), type: 'error' });
        }
      }}
    >
      <X size={14} />
    </Button>
  );
}
export function Pricing() {
  return (
    <>
      <PageHeading
        kicker="Plans & pricing"
        title="Choose your plan"
        description="Compare price, commission and workspace features."
      />
      <PlanCards />
      <PlanPaymentNote />
    </>
  );
}
