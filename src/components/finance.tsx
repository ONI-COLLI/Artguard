import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { formatCents } from '../lib/currency';
import type { FinanceReport } from '../../shared/finance';
import { api } from '../lib/api';
import { useData, useDownload, useFeedback } from '../lib/workspace';
import { ChainAmount, useDisplayCurrency } from './currency';
import { Button, Form, Field, Submit } from './ui';
export function PeriodFinance() {
  const { user } = useData(),
    { currency, rates } = useDisplayCurrency(),
    download = useDownload(),
    { notify } = useFeedback();
  const today = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
  const [period, setPeriod] = useState({ from: today.slice(0, 8) + '01', to: today }),
    [expenseId, setExpenseId] = useState(() => crypto.randomUUID()),
    [voidId, setVoidId] = useState('');
  const path = '/manager/finance?' + new URLSearchParams(period);
  const q = useQuery({
    queryKey: ['period-finance', user?.id, period],
    queryFn: () => api<FinanceReport>(path),
    enabled: !!user?.isManager,
  });
  const fmt = (v: string) => formatCents(BigInt(v), currency, false, rates);
  const reconcile = useMutation({
    mutationFn: () =>
      api<{
        blockNumber: string;
        scope: string;
        contracts: {
          address: string;
          assetsWei: string;
          lockedEscrowWei: string;
          recipientCreditsWei: string;
          refundCreditsWei: string;
          differenceWei: string;
          status: string;
        }[];
      }>('/manager/finance/reconcile', { method: 'POST', data: {} }),
  });
  return (
    <section className="panel form-panel period-finance">
      <div className="panel-heading">
        <h2>Period report & operating result</h2>
        <Button
          busy={download.pending}
          onClick={() =>
            void download.run('/api/manager/finance/export?' + new URLSearchParams(period))
          }
        >
          Export period
        </Button>
      </div>
      <Form
        className="finance-period"
        schema={z
          .object({ from: z.string().min(10), to: z.string().min(10) })
          .refine((v) => v.from <= v.to, { message: 'Start must be before end.', path: ['to'] })}
        defaults={period}
        onSubmit={async (v) => setPeriod({ from: v.from, to: v.to })}
      >
        <Field name="from" type="date" label="From (Kazakhstan time)" />
        <Field name="to" type="date" label="Through" />
        <Submit>Apply period</Submit>
      </Form>
      {q.error && <p role="alert">{q.error.message}</p>}
      <details>
        <summary>Check escrow assets against obligations</summary>
        <p>
          Compare contract assets with locked orders, recipient credits and refund credits at one
          blockchain block.
        </p>
        <Button busy={reconcile.isPending} onClick={() => reconcile.mutate()}>
          Reconcile escrow on-chain
        </Button>
        {reconcile.error && <p role="alert">{reconcile.error.message}</p>}
        {reconcile.data && (
          <>
            <p>
              Block {reconcile.data.blockNumber} · {reconcile.data.scope}
            </p>
            {reconcile.data.contracts.map((c) => (
              <article className="privacy-request" key={c.address}>
                <strong>{c.status}</strong>
                <small>{c.address}</small>
                <p>
                  Contract assets: <ChainAmount wei={c.assetsWei} /> · Locked:{' '}
                  <ChainAmount wei={c.lockedEscrowWei} /> · Recipient credits:{' '}
                  <ChainAmount wei={c.recipientCreditsWei} /> · Refund credits:{' '}
                  <ChainAmount wei={c.refundCreditsWei} /> · Difference:{' '}
                  <ChainAmount wei={c.differenceWei} />
                </p>
              </article>
            ))}
          </>
        )}
      </details>
      {q.data && (
        <>
          <div className="accounting-stats">
            {[
              ['Platform cash receipts', q.data.cashRevenueCents],
              ['Revenue earned in period', q.data.earnedRevenueCents],
              ['Operating costs & entered taxes', q.data.operatingCostsCents],
              ['Model result after entered costs', q.data.profitCents],
              ['Deferred service receipts at period end', q.data.deferredServiceCents],
              ['Completed license sales volume', q.data.salesVolumeCents],
            ].map(([label, value]) => (
              <article className="accounting-stat" key={label}>
                <span>{label}</span>
                <strong>{fmt(value)}</strong>
              </article>
            ))}
          </div>
          <p className="field-hint">{q.data.basis}</p>
          <details>
            <summary>Revenue breakdown, held funds & refunds</summary>
            <p>
              Sales commission: {fmt(q.data.breakdown.commission)} · Subscription service:{' '}
              {fmt(q.data.breakdown.subscriptions)} · Promotion service:{' '}
              {fmt(q.data.breakdown.promotions)}
            </p>
            <p>
              Recorded escrow currently held: <ChainAmount wei={q.data.recordedEscrowWei} />
            </p>
            <p>
              Recorded refunds in period: <ChainAmount wei={q.data.refundsInPeriodWei} />
            </p>
            <p>
              Held funds and refunds are excluded from platform revenue. These escrow values come
              from synchronized records; check live Orders & escrow for pending changes. Refund
              credit and wallet withdrawal are separate.
            </p>
          </details>
          <details>
            <summary>
              Operating expenses ({q.data.expenses.filter((e) => !e.voided_at).length})
            </summary>
            <Form
              key={expenseId}
              schema={z.object({
                category: z.enum([
                  'hosting',
                  'storage',
                  'support',
                  'marketing',
                  'network',
                  'taxes',
                  'other',
                ]),
                amount: z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/),
                occurredOn: z.string().min(10),
                note: z.string().min(3).max(500),
              })}
              defaults={{ category: 'hosting', amount: '', occurredOn: today, note: '' }}
              onSubmit={async (v) => {
                await api('/manager/finance/expenses', {
                  method: 'POST',
                  data: { ...v, id: expenseId },
                });
                setExpenseId(crypto.randomUUID());
                void q.refetch();
                notify({ title: 'Expense recorded' });
              }}
            >
              <p>
                Enter reference USD costs. Display currency conversion does not change recorded
                amounts. Taxes are manual amounts; no tax regime or rate is assumed.
              </p>
              <Field
                name="category"
                label="Category"
                options={[
                  'hosting',
                  'storage',
                  'support',
                  'marketing',
                  'network',
                  'taxes',
                  'other',
                ]}
              />
              <Field name="amount" label="Amount, reference USD" />
              <Field name="occurredOn" type="date" label="Expense date" />
              <Field name="note" label="Description / supporting reference" maxLength={500} />
              <Submit>Record expense</Submit>
            </Form>
            {q.data.expenses.map((e) => (
              <article className="privacy-request" key={e.id}>
                <strong>
                  {e.occurred_on} · {e.category} · {fmt(e.amount_cents)}
                </strong>
                <p>{e.note}</p>
                {e.voided_at ? (
                  <p>Voided: {e.void_reason}</p>
                ) : (
                  <Button className="small" onClick={() => setVoidId(e.id)}>
                    Void entry
                  </Button>
                )}
                {voidId === e.id && !e.voided_at && (
                  <Form
                    schema={z.object({ reason: z.string().min(10).max(500) })}
                    onSubmit={async (v) => {
                      await api('/manager/finance/expenses/' + e.id + '/void', {
                        method: 'POST',
                        data: v,
                      });
                      setVoidId('');
                      void q.refetch();
                    }}
                  >
                    <Field name="reason" label="Reason (entry will remain in history)" />
                    <Submit>Confirm void</Submit>
                  </Form>
                )}
              </article>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
