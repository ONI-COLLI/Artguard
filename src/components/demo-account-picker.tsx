import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { DemoProfileState } from '../../shared/demo';
import { api } from '../lib/api';
import { useData } from '../lib/workspace';

export function DemoAccountPicker() {
  const { user } = useData();
  const profiles = useQuery({
    queryKey: ['demo', 'profiles'],
    queryFn: () => api<{ profiles: DemoProfileState[] }>('/demo/profiles'),
    retry: false,
  });
  function switchTo(profile: DemoProfileState) {
    const url = new URL(window.location.href);
    url.searchParams.set('demo', profile.key);
    url.hash = profile.route;
    window.location.assign(url.toString());
  }
  return (
    <section className="account-demo-picker" aria-label="Demo profiles">
      <div className="account-demo-heading">
        <strong>Test profiles</strong>
        <small>Choose a role in this window</small>
      </div>
      {profiles.isPending && <p role="status">Loading profiles…</p>}
      {profiles.error && <p role="alert">Demo profiles unavailable. <Link to="/demo">Open demo studio</Link></p>}
      <div className="account-demo-list">
        {profiles.data?.profiles.map((profile) => {
          const current = user?.email.toLowerCase() === profile.email.toLowerCase();
          return (
            <button type="button" key={profile.key} disabled={!profile.ready || current}
              onClick={() => switchTo(profile)}>
              <span className="account-demo-avatar">{profile.name[0]}</span>
              <span><strong>{profile.name}</strong><small>{profile.description}</small></span>
              <em>{current ? 'Current' : profile.ready ? 'Switch →' : 'Unavailable'}</em>
            </button>
          );
        })}
      </div>
      <Link className="account-demo-studio" to="/demo">Open profiles in separate windows →</Link>
    </section>
  );
}
