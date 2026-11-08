import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button } from './ui';
import { useData } from '../lib/workspace';
export function DemoMailbox() {
  const { user } = useData();
  const query = useQuery({
    queryKey: ['private-demo-mailbox', user?.id],
    queryFn: () =>
      api<{ messages: { id: string; subject: string; created_at: string; links: string[] }[] }>(
        '/auth/demo-mail',
      ),
    enabled: !!user,
    retry: false,
    refetchInterval: 15000,
  });
  return (
    <section className="local-note">
      <h3>Your private demo inbox</h3>
      <p>
        Messages stay inside this test server. No external email is sent, and this flow does not
        prove ownership of an email address. Use fictional details.
      </p>
      <Button busy={query.isFetching} onClick={() => void query.refetch()}>
        Refresh inbox
      </Button>
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data?.messages.map((m) => (
        <article key={m.id}>
          <strong>{m.subject}</strong>
          {m.links.map((link) => (
            <p key={link}>
              <a className="button small" href={link}>
                Open account verification link
              </a>
            </p>
          ))}
        </article>
      ))}
      {query.data && !query.data.messages.length && (
        <p>No messages yet. Use Send verification message above.</p>
      )}
    </section>
  );
}
