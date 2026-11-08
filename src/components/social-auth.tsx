import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Button } from './ui';
import { useData } from '../lib/workspace';
import { LEGAL_VERSION } from '../../shared/legal';
export function SocialAuth({ link = false }: { link?: boolean }) {
  const { user } = useData();
  const [error, setError] = useState(''),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState('');
  const query = useQuery({
    queryKey: ['oauth-providers', user?.id],
    queryFn: () =>
      api<{ providers: { id: string; name: string; enabled: boolean; connected: boolean }[] }>(
        '/auth/providers',
      ),
    staleTime: 60000,
    retry: false,
  });
  if (!query.data?.providers) return null;
  const providers = query.data.providers.filter((p) => p.enabled);
  if (!providers.length)
    return link ? (
      <p className="field-hint">Social sign-in is not configured for this prototype.</p>
    ) : null;
  return (
    <section
      className="social-auth"
      aria-label={link ? 'Connected sign-in providers' : 'Social sign-in'}
    >
      <div className="social-auth-options">
        {providers.map((p) => (
          <Button
            key={p.id}
            className="full"
            disabled={!p.enabled || (p.connected && link) || !!busy || (!user && !accepted)}
            busy={busy === p.id}
            title={p.enabled ? undefined : 'The site owner has not configured this provider yet.'}
            onClick={async () => {
              setError('');
              setBusy(p.id);
              try {
                const next = await api<{ url: string }>('/auth/oauth/' + p.id + '/start', {
                  method: 'POST',
                  data: { link, legalAccepted: accepted, legalVersion: LEGAL_VERSION },
                });
                window.location.assign(next.url);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Sign-in could not start.');
                setBusy('');
              }
            }}
          >
            {link
              ? p.connected
                ? 'Connected to ' + p.name
                : 'Connect ' + p.name
              : 'Continue with ' + p.name}
          </Button>
        ))}
      </div>
      {!user && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          <span>
            I accept the{' '}
            <Link to="/legal/terms" target="_blank">
              prototype terms
            </Link>{' '}
            and{' '}
            <Link to="/legal/privacy" target="_blank">
              data processing consent
            </Link>{' '}
            before using a sign-in provider.
          </span>
        </label>
      )}
      {query.data.providers.every((p) => !p.enabled) && (
        <p className="field-hint">
          Social sign-in is awaiting provider configuration. Email sign-in is available.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export function OAuthResult() {
  const [params] = useSearchParams(),
    error = params.get('error');
  const messages: Record<string, string> = {
    existing:
      'An account with this email already exists. Sign in with your password, then connect this provider in Account security.',
    email:
      'The provider did not supply a suitable email address. Use email registration or connect the provider to an existing account.',
    linked: 'This provider identity is already connected to a different account.',
    registration: 'New registrations are temporarily paused.',
    cancelled: 'Social sign-in was cancelled.',
    invalid: 'This sign-in request is invalid. Start a new sign-in.',
    provider: 'The provider could not complete sign-in. Check its configuration and try again.',
  };
  return (
    <section className="panel form-panel">
      <h1>{error ? 'Sign-in could not finish' : 'You are signed in'}</h1>
      <p>
        {error
          ? messages[error] || messages.provider
          : 'Your account and wallet remain separate. Open your profile to connect a wallet.'}
      </p>
      <Link className="button primary" to={error ? '/security' : '/profile'}>
        {error ? 'Account security' : 'Open profile'}
      </Link>
    </section>
  );
}
