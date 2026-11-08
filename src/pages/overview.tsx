import { sessionUrl } from '../lib/session';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  Upload,
  FileCheck2,
  Wallet,
  Image,
} from 'lucide-react';
import type { HomeSummary } from '../../shared/home';
import { testEth } from '../../shared/marketplace';
import { api } from '../lib/api';
import { useData } from '../lib/workspace';
import { date } from '../components/ui';
import { useDisplayCurrency } from '../components/currency';
import { formatWei } from '../lib/currency';
import { PlanCards } from '../components/plan-cards';
export function Heatmap() {
  const { money } = useDisplayCurrency();
  const d = useData(),
    [period, setPeriod] = useState(84),
    items = d.user
      ? d.artworks.filter((a) => a.own)
      : d.artworks.filter((a) => a.status === 'published');
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7) - (period - 7));
  const cells = Array.from({ length: period }, (_, i) => {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    const key = day.toLocaleDateString('en-CA'),
      count =
        items.filter((a) => a.date === key).length + d.sales.filter((s) => s.date === key).length;
    return (
      <span
        key={key}
        className={`heat-cell level-${Math.min(count, 4)}`}
        title={`${date(key)}: ${count} activities`}
        aria-label={`${date(key)}: ${count} activities`}
      />
    );
  });
  return (
    <div className="panel activity-panel">
      <div className="panel-heading">
        <h3>Creative activity</h3>
        <div className="segmented">
          {[
            [28, 'Month'],
            [84, 'Quarter'],
            [364, 'Year'],
          ].map(([n, t]) => (
            <button
              key={n}
              className={period === n ? 'active' : ''}
              aria-pressed={period === n}
              onClick={() => setPeriod(Number(n))}
            >
              {t}
            </button>
          ))}
        </div>
        <Link className="icon-link" to="/analytics" aria-label="View analytics">
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="activity-summary">
        <div>
          <strong>
            {
              items.filter((a) => Date.now() - new Date(a.createdAt).getTime() < period * 86400000)
                .length
            }
          </strong>
          <span>Artworks added</span>
        </div>
        <div>
          <strong>
            {
              d.sales.filter(
                (s) => Date.now() - new Date(s.createdAt).getTime() < period * 86400000,
              ).length
            }
          </strong>
          <span>Licenses sold</span>
        </div>
        <div>
          <strong>
            {money(
              d.sales
                .filter(
                  (s) =>
                    !s.payment && Date.now() - new Date(s.createdAt).getTime() < period * 86400000,
                )
                .reduce((s, x) => s + x.net, 0),
            )}
          </strong>
          <span>Local order income</span>
        </div>
      </div>
      <div className="heatmap-wrap">
        <div className="day-labels">
          <span>Mon</span>
          <span>Wed</span>
          <span>Fri</span>
          <span>Sun</span>
        </div>
        <div
          className="heatmap"
          style={{ gridTemplateColumns: `repeat(${period / 7},minmax(0,1fr))` }}
        >
          {cells}
        </div>
      </div>
      <div className="heatmap-footer">
        <span>Every creation is a step forward.</span>
        <span>
          Less <i className="heat-cell level-0" />
          <i className="heat-cell level-1" />
          <i className="heat-cell level-3" /> More
        </span>
      </div>
    </div>
  );
}
export default function Home() {
  const { currency, rates, loading } = useDisplayCurrency();
  const query = useQuery({
    queryKey: ['home-summary'],
    queryFn: ({ signal }) => api<HomeSummary>('/home', { signal }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const summary = query.data,
    featured = summary?.featured,
    volume = summary
      ? formatWei(summary.licenseVolumeWei, currency, rates, { compact: true })
      : null,
    fullVolume = summary ? formatWei(summary.licenseVolumeWei, currency, rates) : null,
    number = (value: number | undefined) =>
      value === undefined ? '—' : value.toLocaleString('en-US');
  const stats = [
    {
      label: 'Completed transactions',
      value: number(summary?.completedTransactions),
      detail: 'License, plan & promotion payments',
    },
    {
      label: 'Licenses issued',
      value: number(summary?.licensesIssued),
      detail: 'Purchased through the blockchain',
    },
    {
      label: 'Projects available',
      value: number(summary?.projectsAvailable),
      detail: 'Ready to explore in the marketplace',
    },
    {
      label: 'License sales volume',
      value: volume ?? '—',
      title: summary
        ? [fullVolume, currency !== 'TEST_ETH' && testEth(summary.licenseVolumeWei)]
            .filter(Boolean)
            .join(' · ')
        : undefined,
      detail:
        summary && volume === null
          ? loading
            ? `Loading ${currency} rate…`
            : `${currency} rate unavailable`
          : 'Total confirmed license payments',
    },
  ];
  return (
    <div className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-intro">
          <div className="eyebrow">ArtGuard · A marketplace for creative work</div>
          <h1 id="home-title">
            Original work.
            <br />
            <span>Clear licenses.</span>
          </h1>
          <p>
            Discover digital artwork, buy the rights to use it, or share your own projects. Keep
            your licenses and blockchain payment records in one place.
          </p>
          <div className="actions">
            <Link className="button primary" to="/marketplace">
              Explore marketplace <ArrowRight size={17} />
            </Link>
            <Link className="button subtle" to="/upload">
              Publish your work <Upload size={16} />
            </Link>
          </div>
          <span className="home-test-note">
            <ShieldCheck size={14} /> Local demo · payments in test ETH
          </span>
        </div>
        {featured ? (
          <Link
            className="home-featured"
            to={'/artwork/' + featured.id}
            aria-label={'Explore project: ' + featured.title}
          >
            <div className="home-featured-image">
              <img src={sessionUrl(featured.image)} alt={featured.title} />
              <span className="home-featured-tag">
                Explore the collection <ArrowUpRight size={14} />
              </span>
            </div>
            <div className="home-featured-caption">
              <div>
                <span>{featured.category}</span>
                <h2>{featured.title}</h2>
                <p>by {featured.author}</p>
              </div>
              <ArrowUpRight size={22} />
            </div>
          </Link>
        ) : (
          <div className="home-featured home-featured-empty">
            <Image size={42} strokeWidth={1} />
            <h2>A new home for your work.</h2>
            <p>Publish a project and make it available to license.</p>
          </div>
        )}
      </section>

      <section
        className="home-activity"
        aria-labelledby="home-activity-title"
        aria-busy={query.isFetching}
      >
        <div className="home-section-heading">
          <h2 id="home-activity-title">ArtGuard in numbers</h2>
          <span className="home-stats-status" role="status">
            {query.isError ? (
              'Statistics could not be refreshed.'
            ) : summary ? (
              <>
                Updated{' '}
                <time dateTime={summary.updatedAt}>
                  {new Date(summary.updatedAt).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </>
            ) : (
              'Loading statistics…'
            )}
            {query.isError && (
              <button
                className="text-button"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                Try again
              </button>
            )}
          </span>
        </div>
        <dl className="home-stats">
          {stats.map((stat) => (
            <div className="home-stat" key={stat.label}>
              <dt>{stat.label}</dt>
              <dd title={stat.title}>{stat.value}</dd>
              <span>{stat.detail}</span>
            </div>
          ))}
        </dl>
        <p className="home-stats-note">
          Confirmed payments on the local test network. Test ETH has no monetary value.
        </p>
      </section>

      <section className="home-how" aria-labelledby="home-how-title">
        <div className="home-section-heading">
          <h2 id="home-how-title">From a great find to your next project.</h2>
          <span>How ArtGuard works</span>
        </div>
        <div className="home-steps">
          {[
            {
              Icon: Image,
              title: 'Find your inspiration',
              text: 'Browse original projects, preview the details and find the right work for your idea.',
            },
            {
              Icon: FileCheck2,
              title: 'Choose your license',
              text: 'Pick personal or commercial use and review the terms before you pay.',
            },
            {
              Icon: Wallet,
              title: 'Accept delivery',
              text: 'Your payment stays in escrow. After the creator confirms delivery, accept it to activate your license and release the payment.',
            },
          ].map(({ Icon, title, text }, index) => (
            <article className="home-step" key={title}>
              <div className="home-step-top">
                <Icon size={23} strokeWidth={1.5} />
                <span>0{index + 1}</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-plans" aria-labelledby="home-plans-title">
        <div className="home-section-heading">
          <div>
            <span className="eyebrow">For independent creators</span>
            <h2 id="home-plans-title">Simple plans. Clear commissions.</h2>
            <p>Start free. Keep more from every sale as you grow.</p>
          </div>
          <span>Monthly pricing · {currency === 'TEST_ETH' ? 'test ETH' : currency}</span>
        </div>
        <PlanCards />
        <p className="home-stats-note">
          Commission applies to each license sale. Demo subscriptions use test ETH for 30 days of
          access.
        </p>
      </section>
    </div>
  );
}
