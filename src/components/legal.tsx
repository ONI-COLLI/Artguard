import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  LEGAL_VERSION,
  consentSummary,
  legalDocuments,
  type LegalOperator,
} from '../../shared/legal';
import { api } from '../lib/api';
import { useData, useAction, useDownload, useFeedback, workspaceKey } from '../lib/workspace';
import { Button, Form, Field, Submit, PageHeading } from './ui';
import { AccessPanel } from './dialogs';
export function LegalPage() {
  const { kind = 'privacy' } = useParams();
  const query = useQuery({
    queryKey: ['legal-operator'],
    queryFn: () => api<{ operator: LegalOperator; version: string }>('/legal'),
  });
  const document = legalDocuments[kind as keyof typeof legalDocuments];
  if (!document) return <p>Document not found.</p>;
  return (
    <div className="legal-page">
      <PageHeading
        kicker="Kazakhstan · educational prototype"
        title={document.title}
        description={'Version ' + LEGAL_VERSION}
      />
      <div className="local-note">
        Демонстрационные документы и реквизиты. Они описывают прототип и не подтверждают готовность
        к работе с реальными деньгами или персональными данными.
      </div>
      {query.data && (
        <section className="panel form-panel">
          <h2>Оператор / Оператор</h2>
          <p>{query.data.operator.name}</p>
          <p>
            {query.data.operator.contact} ·{' '}
            {query.data.operator.bin
              ? 'БИН ' + query.data.operator.bin
              : 'БИН не указан; тестовый оператор'}
          </p>
          <p className="muted">{query.data.operator.hosting}</p>
          <Link to="/privacy">Обращения внутри сайта / Өтініштер</Link>
        </section>
      )}
      <div className="legal-links">
        {Object.entries(legalDocuments).map(([key, doc]) => (
          <Link key={key} to={'/legal/' + key} aria-current={kind === key ? 'page' : undefined}>
            {doc.title}
          </Link>
        ))}
      </div>
      {document.sections.map(([title, text]) => (
        <section className="panel form-panel" key={title}>
          <h2>{title}</h2>
          <p>{text}</p>
        </section>
      ))}
      <p className="muted">
        Правовая основа:{' '}
        <a href="https://adilet.zan.kz/rus/docs/Z1300000094" target="_blank" rel="noreferrer">
          Закон РК «О персональных данных и их защите»
        </a>
        .
      </p>
    </div>
  );
}
type PrivacyData = {
  version: string;
  accepted: boolean;
  alias: string;
  consents: {
    id: string;
    version: string;
    source: string;
    accepted_at: string;
    revoked_at: string | null;
  }[];
  requests: {
    id: string;
    kind: string;
    status: string;
    message: string;
    response: string;
    created_at: string;
  }[];
};
export function PrivacyCenter() {
  const { user } = useData(),
    client = useQueryClient(),
    download = useDownload(),
    { notify } = useFeedback();
  const [confirm, setConfirm] = useState(false);
  const query = useQuery({
    queryKey: ['privacy', user?.id],
    queryFn: () => api<PrivacyData>('/privacy'),
    enabled: !!user,
  });
  const accept = useAction('/privacy/consents'),
    withdraw = useAction('/privacy/withdraw'),
    alias = useAction('/privacy/profile', 'PATCH');
  const refresh = () => {
    void query.refetch();
    void client.invalidateQueries({ queryKey: workspaceKey });
  };
  if (!user) return <AccessPanel />;
  return (
    <div className="privacy-page">
      <PageHeading
        kicker="Account · Kazakhstan prototype"
        title="Privacy & support"
        description="Control your public alias, review consent and send an account or purchase request."
      />
      <div className="legal-links">
        <Link to="/legal/privacy">Privacy policy</Link>
        <Link to="/legal/terms">Service terms</Link>
        <Link to="/legal/refunds">Refund rules</Link>
      </div>
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data && (
        <>
          <section className="panel form-panel">
            <h2>Data processing consent</h2>
            <p>{consentSummary}</p>
            <p>
              <strong>
                {query.data.accepted
                  ? 'Current version accepted'
                  : 'Acceptance required for new transactions'}
              </strong>{' '}
              · {LEGAL_VERSION}
            </p>
            {!query.data.accepted ? (
              <Button
                className="primary"
                busy={accept.isPending}
                onClick={async () => {
                  try {
                    await accept.mutateAsync({ accepted: true, version: LEGAL_VERSION });
                    refresh();
                    notify({ title: 'Consent recorded' });
                  } catch {}
                }}
              >
                Accept current terms & consent
              </Button>
            ) : (
              <details>
                <summary>Withdraw consent</summary>
                <p>
                  New purchases and publications will be restricted. Previous obligations and
                  legally required retention must be reviewed separately. Public blockchain history
                  cannot be erased.
                </p>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  I understand the effect of withdrawal.
                </label>
                <Button
                  disabled={!confirm}
                  busy={withdraw.isPending}
                  onClick={async () => {
                    try {
                      await withdraw.mutateAsync({ confirm: true });
                      setConfirm(false);
                      refresh();
                    } catch {}
                  }}
                >
                  Confirm withdrawal
                </Button>
              </details>
            )}
            {(accept.error || withdraw.error) && (
              <p role="alert">{(accept.error || withdraw.error)?.message}</p>
            )}
            <details>
              <summary>Consent history</summary>
              {query.data.consents.map((c) => (
                <p key={c.id}>
                  {c.version} · {new Date(c.accepted_at).toLocaleString()} ·{' '}
                  {c.revoked_at ? 'withdrawn' : 'accepted'} · {c.source}
                </p>
              ))}
            </details>
          </section>
          <div className="privacy-grid">
            <Form
              className="panel form-panel"
              schema={z.object({ alias: z.string().trim().min(2).max(60) })}
              defaults={{ alias: query.data.alias }}
              onSubmit={async (v) => {
                await alias.mutateAsync(v);
                refresh();
                notify({ title: 'Public alias updated' });
              }}
            >
              <h2>Public creator alias</h2>
              <p>
                Your account name and email stay separate from catalog attribution. Only use a name
                you agree to publish.
              </p>
              <Field name="alias" label="Public alias" maxLength={60} />
              <Submit>Save alias</Submit>
            </Form>
            <section className="panel form-panel">
              <h2>Your data copy</h2>
              <p>
                Download account details, projects, purchases, wallet history, consent and requests.
                Password hashes, keys and sessions are excluded.
              </p>
              <Button
                busy={download.pending}
                onClick={() => void download.run('/api/privacy/export')}
              >
                Download my data (JSON)
              </Button>
            </section>
          </div>
          <Form
            className="panel form-panel"
            schema={z.object({
              kind: z.enum(['deletion', 'access', 'support', 'appeal']),
              message: z.string().trim().min(10).max(2000),
            })}
            defaults={{ kind: 'support', message: '' }}
            onSubmit={async (v, form) => {
              await api('/privacy/requests', { method: 'POST', data: v });
              form.reset({ kind: v.kind, message: '' });
              refresh();
              notify({
                title: 'Request recorded',
                detail:
                  'Follow the response below. Requests do not automatically delete records or reverse payments.',
              });
            }}
          >
            <h2>Send a request / Өтініш</h2>
            <Field
              name="kind"
              label="Request type"
              options={[
                { value: 'support', label: 'Purchase or general support' },
                { value: 'deletion', label: 'Request account deletion' },
                { value: 'access', label: 'Question about my data' },
                { value: 'appeal', label: 'Appeal a dispute decision' },
              ]}
            />
            <Field
              name="message"
              type="textarea"
              label="Describe the request; include the order or deposit hash if relevant"
              maxLength={2000}
            />
            <p className="field-hint">
              Deletion is reviewed by the operator. Settlement obligations, retained documents and
              public chain records are handled separately. Test contact: privacy@artguard.test; use
              this internal form for the demo.
            </p>
            <Submit>Submit request</Submit>
          </Form>
          <section className="panel form-panel">
            <h2>Your requests</h2>
            {query.data.requests.length ? (
              query.data.requests.map((r) => (
                <article className="privacy-request" key={r.id}>
                  <strong>
                    {r.kind} · {r.status}
                  </strong>
                  <small>
                    {r.id} · {new Date(r.created_at).toLocaleDateString()}
                  </small>
                  <p>{r.message}</p>
                  {r.response && <p className="local-note">Operator response: {r.response}</p>}
                </article>
              ))
            ) : (
              <p>No requests yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
export function PrivacyAdmin() {
  const { user } = useData(),
    { notify } = useFeedback();
  const q = useQuery({
    queryKey: ['admin-privacy', user?.id],
    queryFn: () =>
      api<{
        operator: LegalOperator;
        requests: {
          id: string;
          email: string;
          kind: string;
          message: string;
          status: string;
          response: string;
        }[];
      }>('/admin/privacy'),
    enabled: !!user?.isAdmin,
  });
  if (!user?.isAdmin) return <AccessPanel />;
  return (
    <div className="privacy-page">
      <PageHeading
        title="Privacy requests & operator"
        kicker="Technical administration"
        description="Keep demonstration records honest. Answering a request does not erase data."
      />
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data && (
        <>
          <Form
            className="panel form-panel"
            schema={z.object({
              name: z.string().min(2),
              contact: z.email(),
              bin: z.string().regex(/^(\d{12})?$/),
              hosting: z.string().min(5),
            })}
            defaults={q.data.operator}
            onSubmit={async (v) => {
              await api('/admin/privacy/operator', { method: 'PATCH', data: v });
              void q.refetch();
              notify({ title: 'Operator details saved' });
            }}
          >
            <h2>Published operator details</h2>
            <Field name="name" label="Operator name" />
            <Field name="contact" label="Contact email" />
            <Field name="bin" label="BIN (leave blank for this prototype)" />
            <Field name="hosting" label="Hosting and intermediary disclosure" type="textarea" />
            <Submit>Save details</Submit>
          </Form>
          {q.data.requests.map((r) => (
            <Form
              key={r.id}
              className="panel form-panel"
              schema={z.object({
                status: z.enum(['reviewing', 'answered']),
                response: z.string().min(10).max(3000),
              })}
              defaults={{
                status: r.status === 'answered' ? 'answered' : 'reviewing',
                response: r.response,
              }}
              onSubmit={async (v) => {
                await api('/admin/privacy/requests/' + r.id, { method: 'PATCH', data: v });
                void q.refetch();
                notify({ title: 'Response saved' });
              }}
            >
              <h2>
                {r.kind} · {r.email}
              </h2>
              <small>{r.id}</small>
              <p>{r.message}</p>
              <Field name="status" label="Status" options={['reviewing', 'answered']} />
              <Field
                name="response"
                type="textarea"
                label="Response, action taken and retention grounds"
                maxLength={3000}
              />
              <p className="field-hint">
                Record the action actually taken. This form does not erase accounts, files or
                immutable history.
              </p>
              <Submit>Send internal response</Submit>
            </Form>
          ))}
        </>
      )}
    </div>
  );
}
