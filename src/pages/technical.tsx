import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useData, useFeedback } from '../lib/workspace';
import { Button, PageHeading } from '../components/ui';
import { AccessPanel } from '../components/dialogs';
type Status = {
  checkedAt: string;
  runtime: { node: string; uptimeSeconds: number; database: string; schema: number };
  network: {
    ready: boolean;
    message: string;
    chainId: number;
    deployment: { address: string } | null;
  };
  settings: { registrationEnabled: boolean; uploadsEnabled: boolean };
  pending: { registrations: number; checkouts: number };
  staff: { id: string; name: string; email: string; isManager: number }[];
};
export default function Technical() {
  const { user } = useData(),
    client = useQueryClient(),
    { notify } = useFeedback();
  const allowed = !!user?.isAdmin && user.emailVerified;
  const query = useQuery({
    queryKey: ['technical', user?.id],
    queryFn: () => api<Status>('/admin/technical'),
    enabled: allowed,
    refetchInterval: 30000,
    retry: false,
  });
  const save = useMutation({
    mutationFn: (settings: Status['settings']) =>
      api('/admin/technical/settings', { method: 'PATCH', data: settings }),
    onSuccess: () => {
      void query.refetch();
      notify({ title: 'Site settings saved' });
    },
  });
  const manager = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api('/admin/technical/managers/' + id, { method: 'PATCH', data: { enabled } }),
    onSuccess: () => {
      void query.refetch();
      void client.invalidateQueries({ queryKey: ['workspace'] });
      notify({ title: 'Manager access updated' });
    },
  });
  if (!user) return <AccessPanel />;
  if (!allowed)
    return (
      <div className="panel form-panel">
        <h2>Technical administrator access required</h2>
        <p>Managers can open site statistics from their profile.</p>
      </div>
    );
  const data = query.data;
  return (
    <div className="platform-page">
      <PageHeading
        kicker="Technical administration"
        title="Site operations"
        description="Service health, access management and blockchain tools."
        action={
          <Button busy={query.isFetching} onClick={() => void query.refetch()}>
            Refresh status
          </Button>
        }
      />
      {query.error && (
        <p role="alert" className="form-error">
          {query.error.message}
        </p>
      )}
      {data && (
        <>
          <div className="accounting-stats">
            <article className="panel form-panel">
              <h3>Application</h3>
              <p>
                Node {data.runtime.node} · {data.runtime.database} schema {data.runtime.schema}
              </p>
              <p>Uptime: {Math.floor(data.runtime.uptimeSeconds / 60)} minutes</p>
            </article>
            <article className="panel form-panel">
              <h3>Local blockchain</h3>
              <p>{data.network.message}</p>
              <p>Chain {data.network.chainId}</p>
              <Link className="button" to="/admin/blockchain-demo">
                Open interactive blockchain lab →
              </Link>
            </article>
            <article className="panel form-panel">
              <h3>Verification queue</h3>
              <p>{data.pending.registrations} pending registrations</p>
              <p>{data.pending.checkouts} pending checkouts</p>
            </article>
          </div>
          <section className="panel form-panel">
            <h2>Site availability</h2>
            <label className="check-label">
              <input
                type="checkbox"
                checked={data.settings.registrationEnabled}
                disabled={save.isPending}
                onChange={(e) =>
                  save.mutate({ ...data.settings, registrationEnabled: e.target.checked })
                }
              />
              Allow new registrations
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={data.settings.uploadsEnabled}
                disabled={save.isPending}
                onChange={(e) =>
                  save.mutate({ ...data.settings, uploadsEnabled: e.target.checked })
                }
              />
              Allow new project uploads
            </label>
            <p className="field-hint">
              Existing accounts, projects and purchased licenses remain available.
            </p>
            {save.error && <p role="alert">{save.error.message}</p>}
          </section>
          <section className="panel form-panel">
            <h2>Manager access</h2>
            <p className="muted">
              Managers can view turnover, commission, users and payment records. Technical
              administrators have a separate permission.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Management permission</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.name}
                        <small className="muted"> {u.email}</small>
                      </td>
                      <td>
                        <Button
                          disabled={manager.isPending}
                          onClick={() => manager.mutate({ id: u.id, enabled: !u.isManager })}
                        >
                          {u.isManager ? 'Remove manager access' : 'Grant manager access'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {manager.error && (
              <p role="alert" className="form-error">
                {manager.error.message}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
