import { sessionUrl } from '../lib/session';
import { useSearchParams, Link, useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useFormContext } from 'react-hook-form';
import { ArrowRight, ArrowUpRight, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import { useData, useAction, useFeedback, useDownload } from '../lib/workspace';
import { useDialog } from '../components/dialogs';
import { ArtworkCard } from '../components/artwork';
import { ChainRegistrationCard } from '../components/chain-registration';
import { BlockchainCheckout } from '../components/blockchain-checkout';
import { PromotedShelf, PromoteButton } from '../components/promotions';
import { PageHeading, Empty, date, Form, Submit } from '../components/ui';
import { CurrencyNote, useDisplayCurrency } from '../components/currency';
import { convertInput } from '../lib/currency';
import { Select } from '../components/select';
import { ProjectGallery } from '../components/project-gallery';
import { categories, licenseTypes } from '../../shared/schemas';
import { detailedUsage, licensePeriodRule } from '../../shared/license-terms';
import type { Artwork, LicenseId } from '../../shared/types';
import { licensePeriodLabel } from '../../shared/marketplace';
import { ShareStatusCard } from './coauthors';
import { ReportForm } from './moderation';
export default function Marketplace() {
  const { currency, rates, money, available, fromUsd, toUsd } = useDisplayCurrency();
  const { artworks } = useData(),
    [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterMenu = useRef<HTMLDivElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const closeFilters = () => {
    setFiltersOpen(false);
    filterButton.current?.focus();
  };
  useEffect(() => {
    if (!filtersOpen) return;
    const menu = filterMenu.current;
    menu?.querySelector<HTMLButtonElement>('[role="combobox"]')?.focus();
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !menu?.contains(event.target)) setFiltersOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setFiltersOpen(false);
        filterButton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [filtersOpen]);
  const search = params.get('search') || '',
    category = params.get('category') || '',
    license = params.get('license') || '',
    max = params.get('max') || '',
    sort = params.get('sort') || 'newest';
  const extraFilterCount = Number(Boolean(license)) + Number(Boolean(max));
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const factor = license in licenseTypes ? licenseTypes[license as LicenseId].factor : 1;
  const items = artworks
    .filter(
      (a) =>
        a.status === 'published' &&
        (!category || a.category === category) &&
        (!license || a.licenses.includes(license as LicenseId)) &&
        (!max || a.price * factor <= Number(max)) &&
        `${a.title} ${a.author} ${a.description}`
          .toLowerCase()
          .includes(search.toLowerCase().trim()),
    )
    .sort((a, b) =>
      sort === 'cheap'
        ? a.price - b.price
        : sort === 'expensive'
          ? b.price - a.price
          : b.createdAt.localeCompare(a.createdAt),
    );
  return (
    <>
      <PageHeading
        kicker="The marketplace"
        title="Good work finds a home."
        description="Original artwork. Clear licenses. Endless possibilities."
      />
      <div className="market-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search artwork"
            value={search}
            onChange={(e) => set('search', e.target.value)}
            placeholder="Search artwork or creators…"
          />
        </div>
        <Select
          aria-label="Category"
          value={category}
          onChange={(value) => set('category', value)}
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
        />
        <Select
          aria-label="Sort artwork"
          value={sort}
          onChange={(value) => set('sort', value)}
          options={[
            { value: 'newest', label: 'Newest first' },
            { value: 'cheap', label: 'Price: low to high' },
            { value: 'expensive', label: 'Price: high to low' },
          ]}
        />
        <div className="market-filter-menu" ref={filterMenu}>
          <button
            type="button"
            ref={filterButton}
            className="market-filter-toggle"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            aria-controls="market-extra-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={18} />
            Filters
            {extraFilterCount > 0 && <span className="filter-count">{extraFilterCount}</span>}
          </button>
          <div
            id="market-extra-filters"
            className="market-extra-filters"
            role="dialog"
            aria-label="Marketplace filters"
            hidden={!filtersOpen}
          >
            <div>
              <label htmlFor="market-license">License type</label>
              <Select
                id="market-license"
                value={license}
                onChange={(value) => set('license', value)}
                options={[
                  { value: '', label: 'Any license' },
                  ...Object.entries(licenseTypes).map(([k, v]) => ({ value: k, label: v.title })),
                ]}
              />
            </div>
            <label>
              Maximum price, {currency === 'TEST_ETH' ? 'test ETH' : currency}
              <input
                type="number"
                min="0"
                aria-label="Maximum price"
                step="any"
                placeholder="No limit"
                disabled={!available}
                value={max ? (fromUsd(max) ?? '') : ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? '' : toUsd(e.target.value);
                  if (value !== null) set('max', value);
                }}
              />
            </label>
            <div className="market-filter-actions">
              <button
                type="button"
                className="text-button"
                disabled={!extraFilterCount}
                onClick={() =>
                  setParams(
                    (p) => {
                      p.delete('license');
                      p.delete('max');
                      return p;
                    },
                    { replace: true },
                  )
                }
              >
                Reset
              </button>
              <button type="button" className="small primary" onClick={closeFilters}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
      <CurrencyNote />
      {(search || category || license || max) && (
        <div className="active-filters">
          {[
            ['search', search],
            ['category', category],
            [
              'license',
              license in licenseTypes ? licenseTypes[license as LicenseId].title : license,
            ],
            [
              'max',
              max
                ? `Up to ${convertInput(max, 'USD', currency, rates, true) ?? money(Number(max))}`
                : '',
            ],
          ]
            .filter(([, v]) => v)
            .map(([key, value]) => (
              <button
                className="filter-chip"
                key={key}
                onClick={() => set(key, '')}
                aria-label={'Remove filter: ' + value}
              >
                {value}
                <span>×</span>
              </button>
            ))}
          <button className="text-button" onClick={() => setParams({})}>
            Clear all
          </button>
        </div>
      )}
      <PromotedShelf artworks={items} />
      <div className="results-label" role="status">
        <span>
          {items.length} {items.length === 1 ? 'artwork' : 'artworks'} available to explore
        </span>
        <span>Handmade by humans. Licensed with clarity.</span>
      </div>
      {items.length ? (
        <div className="art-grid">
          {items.map((a) => (
            <ArtworkCard artwork={a} key={a.id} />
          ))}
        </div>
      ) : (
        <Empty
          title="No artwork found"
          description="Try another search or reset the filters."
          to="/marketplace"
          label="Clear filters"
        />
      )}
    </>
  );
}
function CheckoutTerms() {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  return (
    <>
      <label className="check-label">
        <input type="checkbox" {...register('accepted')} />
        <span>I have reviewed the usage terms for this local license.</span>
      </label>
      {errors.accepted && (
        <p className="field-error" role="alert">
          {String(errors.accepted.message)}
        </p>
      )}
    </>
  );
}
export function Checkout({ artwork: a, license }: { artwork: Artwork; license: LicenseId }) {
  const { money } = useDisplayCurrency();
  const [paymentMode, setPaymentMode] = useState<'blockchain' | 'local'>('blockchain');
  const { user, publicDemo } = useData();
  const action = useAction('/purchases'),
    { close, auth, open } = useDialog(),
    { notify } = useFeedback(),
    navigate = useNavigate();
  return (
    <div className="license-checkout">
      <div className="checkout-art">
        <img src={sessionUrl(a.image)} alt="" />
        <div>
          <h3>{a.title}</h3>
          <p className="muted small-text">
            {a.author} · {licenseTypes[license].title} license
          </p>
        </div>
      </div>
      {paymentMode === 'local' && (
        <>
          <div className="checkout-row">
            <span>Total</span>
            <strong>{money(a.price * licenseTypes[license].factor)}</strong>
          </div>
          <p className="muted small-text">{licenseTypes[license].description}</p>
        </>
      )}
      <p className="muted small-text">{licensePeriodLabel(a.licenseDurationDays || 0)}</p>
      {!a.licenseDurationDays && !(publicDemo && !a.seeded) && (
        <div className="segmented payment-modes" aria-label="Payment method">
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
      )}
      {!user && (
        <div className="local-note">
          <p>Sign in to continue with this license.</p>
          <button
            className="full"
            onClick={() =>
              auth('login', () => open('Get a license', <Checkout artwork={a} license={license} />))
            }
          >
            Sign in to continue
          </button>
        </div>
      )}
      {paymentMode === 'blockchain' ? (
        <BlockchainCheckout key={`${a.id}:${license}`} items={[{ artworkId: a.id, license }]} />
      ) : user ? (
        <Form
          schema={z.object({
            accepted: z.literal(true, { error: 'Review and confirm the terms before continuing.' }),
          })}
          defaults={{ accepted: false }}
          onSubmit={async () => {
            await action.mutateAsync({ items: [{ artworkId: a.id, license }] });
            close();
            navigate('/licenses');
            notify({
              title: 'Your license is ready',
              detail:
                'Usage rights and the original file are available in My licenses. No payment was collected.',
              href: '/licenses',
              label: 'Open My licenses',
            });
          }}
        >
          <CheckoutTerms />
          <div className="local-note">Local order only. No money will be charged.</div>
          <Submit>
            Confirm local order <ArrowRight size={16} />
          </Submit>
        </Form>
      ) : null}
    </div>
  );
}
export function ArtworkDetail() {
  const { money } = useDisplayCurrency();
  const { id } = useParams(),
    d = useData(),
    a = d.artworks.find((a) => a.id === id),
    [selected, setSelected] = useState<LicenseId | null>(null),
    dialog = useDialog(),
    { notify } = useFeedback(),
    download = useDownload();
  if (!a)
    return <Empty title="Artwork not found" description="It may be unpublished or unavailable." />;
  const license = selected && a.licenses.includes(selected) ? selected : a.licenses[0];
  const buy = () => {
    const proceed = () => dialog.open('Get a license', <Checkout artwork={a} license={license} />);
    if (d.purchases.some((p) => p.artworkId === a.id && p.license === license && !p.expired)) {
      notify({
        title: 'You already own this license',
        href: '/licenses',
        label: 'Open My licenses',
        type: 'info',
      });
      return;
    }
    proceed();
  };
  return (
    <>
      <Link className="back-link" to="/marketplace">
        ← Back to marketplace
      </Link>
      <div className="detail-layout">
        <ProjectGallery key={a.id} artwork={a} />
        <div className="project-purchase-wrap">
          <aside className="panel purchase-panel project-purchase">
            {a.moderation?.hidden && (
              <p className="form-error">Hidden by a moderator: {a.moderation.reason}</p>
            )}
            {a.shareApproval && !a.shareApproval.ready && <ShareStatusCard artwork={a} />}
            <span className={'status ' + (a.status === 'draft' ? 'draft' : '')}>
              <i />
              {a.status === 'draft' ? 'Draft' : 'Available for licensing'}
            </span>
            <h1>{a.title}</h1>
            <div className="detail-creator">
              <span className="avatar">{a.author[0]}</span>
              <div>
                <small>Created by</small>
                <strong>{a.author}</strong>
              </div>
            </div>
            <div className="project-license-form">
              <label htmlFor="detail-license">License</label>
              <Select
                id="detail-license"
                value={license}
                onChange={(value) => setSelected(value as LicenseId)}
                options={a.licenses.map((k) => ({
                  value: k,
                  label: licenseTypes[k].title + ' license',
                }))}
              />
              <p className="muted small-text license-summary">
                {a.usagePolicyVersion ? detailedUsage[license] : licenseTypes[license].description}
              </p>
              <div className="detail-price" aria-live="polite">
                <strong>{money(a.price * licenseTypes[license].factor)}</strong>
                <span>{licensePeriodLabel(a.licenseDurationDays || 0)}</span>
              </div>
              {a.own ? (
                <Link className="button primary full" to={'/edit/' + a.id}>
                  Edit your artwork
                  <ArrowRight size={16} />
                </Link>
              ) : (
                <button
                  className="primary full"
                  disabled={
                    a.status !== 'published' ||
                    a.shareApproval?.ready === false ||
                    a.moderation?.hidden
                  }
                  onClick={buy}
                >
                  Get this license
                  <ArrowRight size={16} />
                </button>
              )}
              <p className="checkout-note">Local test ETH or a local order. No real money.</p>
            </div>
          </aside>
        </div>
        <section className="panel project-description" aria-label="Project description">
          <details className="usage-details">
            <summary>Usage rights & license period</summary>
            <p>
              {a.usagePolicyVersion ? detailedUsage[license] : licenseTypes[license].description}
            </p>
            {a.usagePolicyVersion && <p>{licensePeriodRule}</p>}
            {!a.usagePolicyVersion && (
              <p className="muted">
                This existing project uses historical registered terms. The frozen quote and your
                license document control the purchase; the expanded policy is for new projects.
              </p>
            )}
            <Link to="/legal/refunds">Escrow, refunds & support</Link>
          </details>
          <h2>Description</h2>
          <p>{a.description}</p>
        </section>
        <div className="project-secondary">
          {a.own && (
            <div className="project-owner-actions">
              <PromoteButton artwork={a} />
              <button
                className="small"
                disabled={download.pending}
                onClick={() => void download.run(`/api/artworks/${a.id}/download`)}
              >
                Download original
              </button>
            </div>
          )}
          <details className="project-more-info" key={a.id}>
            <summary>
              Additional information <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <div className="project-info-content">
              <section>
                <h2>Project details</h2>
                <div className="detail-facts">
                  <div>
                    <span>Category</span>
                    <strong>{a.category}</strong>
                  </div>
                  <div>
                    <span>Format</span>
                    <strong>{a.format}</strong>
                  </div>
                  <div>
                    <span>Added</span>
                    <strong>{date(a.date)}</strong>
                  </div>
                </div>
              </section>
              <section className="project-registration-info">
                <h3>File registration</h3>
                <p>
                  {a.seeded
                    ? 'Sample artwork · illustration preview'
                    : 'SHA-256 fingerprint calculated on upload'}
                </p>
                <Link to={'/verify/' + a.id}>
                  View registration <ArrowUpRight size={13} />
                </Link>
              </section>
              <ChainRegistrationCard key={`${a.id}:${d.user?.id || 'guest'}`} artwork={a} />
              {a.shareApproval?.ready && <ShareStatusCard artwork={a} />}
              <p className="small-text muted">
                A license grants usage rights. Copyright stays with the creator.
              </p>
            </div>
          </details>
          {!a.own && (
            <button
              className="text-button"
              onClick={() => {
                const show = () =>
                  dialog.open('Report this project', <ReportForm artworkId={a.id} />);
                d.user ? show() : dialog.auth('login', show);
              }}
            >
              Report project
            </button>
          )}
        </div>
      </div>
    </>
  );
}
