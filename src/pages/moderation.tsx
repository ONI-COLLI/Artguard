import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useData, useFeedback, workspaceKey } from '../lib/workspace';
import { api } from '../lib/api';
import { PageHeading, Form, Field, Submit } from '../components/ui';
import { AccessPanel } from '../components/dialogs';
interface Report {
  id: string;
  artwork_id: string;
  title: string;
  category: string;
  details: string;
  status: string;
  reporter: string;
  review_note: string | null;
}
interface Project {
  id: string;
  title: string;
  creator: string;
  hidden: number;
  reason: string;
}
export function ReportForm({ artworkId }: { artworkId: string }) {
  const { notify } = useFeedback(),
    action = useMutation({
      mutationFn: (data: unknown) => api('/reports', { method: 'POST', data }),
      onSuccess: () =>
        notify({
          title: 'Report submitted',
          detail: 'A moderator can review your report. Its status is available in My reports.',
        }),
    });
  return action.isSuccess ? (
    <p role="status">
      Your report was submitted. <Link to="/reports">View status</Link>
    </p>
  ) : (
    <Form
      schema={z.object({
        category: z.enum(['copyright', 'inappropriate', 'fraud', 'other']),
        details: z.string().trim().min(10).max(2000),
      })}
      defaults={{ category: 'copyright', details: '' }}
      onSubmit={async (v) => {
        await action.mutateAsync({ ...v, artworkId });
      }}
    >
      <p className="muted small-text">
        Explain the issue and include supporting references. Reports are visible to moderators, and
        your identity is not shown to the creator.
      </p>
      <Field
        name="category"
        label="Reason"
        options={['copyright', 'inappropriate', 'fraud', 'other']}
      />
      <Field
        name="details"
        label="Details and supporting references"
        type="textarea"
        maxLength={2000}
      />
      <Submit>Submit report</Submit>
    </Form>
  );
}
export function MyReports() {
  const { user } = useData(),
    q = useQuery({
      queryKey: ['my-reports', user?.id],
      queryFn: () =>
        api<{
          reports: {
            id: string;
            title: string;
            category: string;
            details: string;
            status: string;
            reviewNote: string | null;
          }[];
        }>('/reports'),
      enabled: !!user,
    });
  return (
    <div className="platform-page">
      <PageHeading kicker="Support" title="Your project reports." />
      {!user ? (
        <AccessPanel />
      ) : q.isPending ? (
        <p>Loading reports…</p>
      ) : q.error ? (
        <p className="form-error">{q.error.message}</p>
      ) : q.data?.reports.length ? (
        q.data.reports.map((r) => (
          <article key={r.id} className="panel form-panel">
            <h3>{r.title}</h3>
            <p>
              {r.category} · {r.status}
            </p>
            <p>{r.details}</p>
            {r.reviewNote && <p>Moderator: {r.reviewNote}</p>}
          </article>
        ))
      ) : (
        <p className="local-note">You have not submitted any reports.</p>
      )}
    </div>
  );
}
export default function Moderation() {
  const { user } = useData(),
    client = useQueryClient(),
    { notify } = useFeedback();
  const q = useQuery({
    queryKey: ['moderation', user?.id],
    queryFn: () =>
      api<{
        reports: Report[];
        artworks: Project[];
        actions: {
          id: string;
          title: string;
          action: string;
          reason: string;
          created_at: string;
        }[];
      }>('/admin/moderation'),
    enabled: !!user?.isAdmin,
    refetchInterval: 15000,
  });
  const action = useMutation({
    mutationFn: ({ path, data }: { path: string; data: unknown }) =>
      api(path, { method: 'POST', data }),
    onSuccess: () => {
      void q.refetch();
      void client.invalidateQueries({ queryKey: workspaceKey });
      notify({ title: 'Moderation action saved' });
    },
  });
  return (
    <div className="platform-page">
      <PageHeading kicker="Moderator workspace" title="Review reports and catalog access." />
      {!user ? (
        <AccessPanel />
      ) : !user.isAdmin ? (
        <p className="local-note">
          Moderator access is required. The workspace owner grants it from the project terminal.
        </p>
      ) : q.isPending ? (
        <p>Loading moderation workspace…</p>
      ) : q.error ? (
        <p className="form-error">{q.error.message}</p>
      ) : (
        <>
          <h2>Reports</h2>
          {!q.data?.reports.length && <p className="muted">No reports yet.</p>}
          {q.data?.reports.map((r) => (
            <article className="panel form-panel" key={r.id}>
              <h3>{r.title}</h3>
              <p>
                {r.category} · {r.status} · Reported by {r.reporter}
              </p>
              <p>{r.details}</p>
              {r.review_note && <p>Review: {r.review_note}</p>}
              {r.status === 'open' && (
                <Form
                  schema={z.object({
                    status: z.enum(['resolved', 'dismissed']),
                    note: z.string().trim().min(5).max(1000),
                  })}
                  defaults={{ status: 'resolved', note: '' }}
                  onSubmit={async (v) => {
                    await action.mutateAsync({ path: `/admin/reports/${r.id}/review`, data: v });
                  }}
                >
                  <Field name="status" label="Review outcome" options={['resolved', 'dismissed']} />
                  <Field name="note" label="Review note" type="textarea" />
                  <Submit>Save report review</Submit>
                </Form>
              )}
            </article>
          ))}
          <h2>Catalog visibility</h2>
          <p className="muted small-text">
            Hiding a project blocks new catalog access and new orders. Creators and existing license
            holders retain access. Previously signed payment quotes remain valid until their expiry.
          </p>
          {q.data?.artworks.map((a) => (
            <article className="panel form-panel" key={`${a.id}:${a.hidden}`}>
              <h3>{a.title}</h3>
              <p>
                {a.creator} ·{' '}
                {a.hidden ? 'Hidden by moderator' : 'Visible if published and approved'}
              </p>
              <Link to={`/artwork/${a.id}`}>Review preview</Link>
              <Form
                schema={z.object({ reason: z.string().trim().min(5).max(1000) })}
                defaults={{ reason: a.reason }}
                onSubmit={async (v) => {
                  await action.mutateAsync({
                    path: `/admin/artworks/${a.id}/moderation`,
                    data: { hidden: !a.hidden, ...v },
                  });
                }}
              >
                <Field name="reason" label="Reason for this visibility change" />
                <Submit>{a.hidden ? 'Restore catalog access' : 'Hide project'}</Submit>
              </Form>
            </article>
          ))}
          <h2>Action history</h2>
          {q.data?.actions.map((a) => (
            <div className="panel form-panel" key={a.id}>
              <strong>
                {a.title} · {a.action}
              </strong>
              <p>{a.reason}</p>
              <small>{a.created_at}</small>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
