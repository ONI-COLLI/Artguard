import { useEffect, useRef, useState } from 'react';
import { useConnect, useConnection, useDisconnect, useConnectors } from 'wagmi';
import { demoProfiles, type DemoWalletState } from '../../shared/demo';
import { api } from '../lib/api';
import { useWorkspace, workspaceKey } from '../lib/workspace';
import { useQueryClient } from '@tanstack/react-query';
import { windowContext } from '../lib/session';
import type { Workspace } from '../../shared/types';

const launchProfile = new URLSearchParams(window.location.search).get('demo');
export function DemoSession() {
  const workspace = useWorkspace(),
    client = useQueryClient();
  const connection = useConnection(),
    connect = useConnect(),
    disconnect = useDisconnect(),
    connectors = useConnectors();
  const started = useRef(false),
    [error, setError] = useState('');
  const userId = workspace.data?.user?.id;
  useEffect(() => {
    const profile = demoProfiles.find((p) => p.key === launchProfile);
    if (!profile || !windowContext || started.current || !workspace.data) return;
    started.current = true;
    void api<Workspace>('/auth/login', {
      method: 'POST',
      data: { email: profile.email, password: profile.password },
    })
      .then((next) => {
        client.setQueryData(workspaceKey, next);
        const url = new URL(window.location.href);
        url.searchParams.delete('demo');
        window.history.replaceState(null, '', url);
      })
      .catch((e) =>
        setError(e.message + ' Sign in with the account password, or run npm run demo:setup.'),
      );
  }, [!!workspace.data, client]);
  useEffect(() => {
    let active = true;
    if (!userId) {
      if (connection.connector?.id === 'artguard-demo')
        disconnect.mutate({ connector: connection.connector });
      return;
    }
    void api<DemoWalletState>('/demo/wallet')
      .then(async (wallet) => {
        if (!active || !wallet.available) return;
        if (
          connection.connector?.id === 'artguard-demo' &&
          connection.address?.toLowerCase() === wallet.address?.toLowerCase()
        )
          return;
        const connector = connectors.find((c) => c.id === 'artguard-demo');
        if (connector) {
          // The tab may just have switched demo identities. Wagmi must drop the
          // previous connection before connecting the same connector to its new wallet.
          if (connection.connector?.id === 'artguard-demo') {
            await disconnect.mutateAsync({ connector: connection.connector });
            if (!active) return;
          }
          await connect.mutateAsync({ connector, chainId: 31337 });
        }
      })
      .catch((e) => {
        if (active) setError('Demo wallet: ' + e.message);
      });
    return () => {
      active = false;
    };
  }, [userId]);
  return error ? (
    <div className="connection-notice" role="alert">
      {error}
      <button onClick={() => setError('')}>Dismiss</button>
    </div>
  ) : null;
}
