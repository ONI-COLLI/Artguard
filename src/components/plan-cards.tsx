import { ArrowRight, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { PlanId } from '../../shared/types';
import { useData } from '../lib/workspace';
import { useDialog } from './dialogs';
import { Button } from './ui';
import { CurrencyNote, useDisplayCurrency } from './currency';

type PaidPlan = Exclude<PlanId, 'free'>;
export function PlanCards({
  onChoose,
  onFree,
  disabled = false,
  busy = false,
  selected,
}: {
  onChoose?: (plan: PaidPlan) => void;
  onFree?: () => void;
  disabled?: boolean;
  busy?: boolean;
  selected?: string | null;
}) {
  const { money, currency, rates } = useDisplayCurrency();
  const { user, plans } = useData(),
    dialog = useDialog(),
    navigate = useNavigate();
  const features: Record<PlanId, string[]> = {
    free: [
      `${plans.free.limit} artwork uploads`,
      'Personal, commercial & extended licenses',
      'Basic earnings overview',
    ],
    premium: [
      `${plans.premium.limit.toLocaleString('en-US')} artwork uploads`,
      'Full analytics',
      'Sales and CSV exports',
    ],
    business: [
      `${plans.business.limit.toLocaleString('en-US')} artwork uploads`,
      'Team directory & bulk licensing',
      'Full analytics and CSV exports',
    ],
  };
  const descriptions = {
    free: 'Start your portfolio.',
    premium: 'Grow your creative business.',
    business: 'Manage a creative team.',
  };
  return (
    <>
      <div className="plan-comparison" aria-label="Available plans">
        {(['free', 'premium', 'business'] as const).map((id) => {
          const current = user?.plan === id,
            otherPaid = id !== 'free' && !!user && user.plan !== 'free' && !current;
          const go = () => {
            if (!user && id === 'free') {
              dialog.auth('register', () => navigate('/profile'));
              return;
            }
            if (onChoose && id !== 'free') {
              onChoose(id);
              return;
            }
            if (id === 'free' && onFree) {
              onFree();
              return;
            }
            const next = () =>
              navigate(id === 'free' || current ? '/billing' : '/billing?plan=' + id);
            user ? next() : dialog.auth('login', next);
          };
          const label = current
            ? id === 'free'
              ? 'Current plan'
              : onChoose
                ? 'Renew for 30 days'
                : 'Manage plan'
            : otherPaid
              ? 'Available after current plan'
              : id === 'free'
                ? user
                  ? onFree
                    ? user.subscription?.cancelAtEnd
                      ? 'Free after expiry'
                      : 'End paid plan at expiry'
                    : 'Manage renewal'
                  : 'Start with Free'
                : 'Choose ' + plans[id].name;
          return (
            <article
              className={
                'panel comparison-card' +
                (id === 'premium' ? ' recommended-plan' : '') +
                (current ? ' current-plan' : '') +
                (selected === id ? ' selected-plan' : '')
              }
              key={id}
              aria-label={plans[id].name + ' plan'}
            >
              {id === 'premium' && <span className="recommended-plan-label">Recommended</span>}
              <div className="comparison-card-heading">
                <h3>{plans[id].name}</h3>
                {current && (
                  <span className="current-plan-label">
                    <Check size={11} /> Current plan
                  </span>
                )}
                {!current && selected === id && (
                  <span className="current-plan-label">Selected</span>
                )}
              </div>
              <p className="plan-description">{descriptions[id]}</p>
              <div
                className={`comparison-price currency-${currency.toLowerCase()} ${rates[currency]?.kind === 'crypto' || currency === 'TEST_ETH' ? 'currency-crypto' : 'currency-fiat'}`}
              >
                <strong>{money(plans[id].price, true)}</strong>
                <span>/ month</span>
              </div>
              <div className="plan-commission">
                <strong>{plans[id].commission}%</strong>
                <span>sales commission</span>
              </div>
              <ul>
                {features[id].map((feature) => (
                  <li key={feature}>
                    <Check size={13} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                className={
                  'full ' + ((id === 'premium' && !current) || selected === id ? 'primary' : '')
                }
                disabled={
                  disabled ||
                  otherPaid ||
                  (current && id === 'free') ||
                  (id === 'free' && !!user?.subscription?.cancelAtEnd)
                }
                busy={busy && selected === id}
                onClick={go}
              >
                {label}
                {!(current && id === 'free') && <ArrowRight size={14} />}
              </Button>
            </article>
          );
        })}
      </div>
      <CurrencyNote />
      <details className="plan-economics">
        <summary>Which plan fits my sales?</summary>
        <p>
          Comparing only the plan fee and sales commission over a 30-day period: Free is lowest
          below {money(200)} in sales, Premium between {money(200)} and {money(800)}, and Business
          above {money(800)}. Plans tie at the thresholds; upload limits and other features can
          change your choice.
        </p>
        <p>
          Commission is deducted before co-author shares. Gas is separate. Prices shown in other
          currencies are reference conversions.
        </p>
      </details>
    </>
  );
}
export function PlanPaymentNote() {
  return (
    <p className="plan-payment-note">
      Paid plans provide 30 days of access with test ETH on ArtGuard Local. Renewals are manual; no
      automatic charges.
    </p>
  );
}
