import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Shield, ArrowRight } from 'lucide-react';
import type { Artwork } from '../../shared/types';
import { api } from '../lib/api';
import { useData } from '../lib/workspace';
import { PageHeading, Form, Field, Submit, date } from '../components/ui';
import { ChainRegistrationCard } from '../components/chain-registration';
export default function Registry() {
  const { id } = useParams(),
    d = useData(),
    sample = d.artworks.find((a) => a.id === id),
    [result, setResult] = useState<Artwork | null | undefined>();
  const mutation = useMutation({
    mutationFn: (query: string) =>
      api<{ artwork: Artwork | null }>('/verify?query=' + encodeURIComponent(query)),
  });
  return (
    <>
      <PageHeading
        kicker="A record of your creativity"
        title="Know what you are working with."
        description="Look up a registration ID or SHA-256 fingerprint in your local registry."
      />
      <div className="verify-layout">
        <Form
          className="panel form-panel"
          schema={z.object({
            query: z.string().trim().min(1, 'Enter a registration ID or file hash.').max(200),
          })}
          defaults={{ query: sample?.registration || '' }}
          onSubmit={async (v) => {
            setResult(undefined);
            const next = await mutation.mutateAsync(v.query);
            setResult(next.artwork);
          }}
        >
          <Field
            name="query"
            label="Registration ID or file hash"
            placeholder="AG-… or SHA-256 hash"
          />
          <Submit pendingText="Checking…">
            Check registration <ArrowRight size={16} />
          </Submit>
          <div aria-live="polite">
            {result !== undefined &&
              (result ? (
                <div className="registry-result">
                  <span className="status">
                    <i />
                    Local record found
                  </span>
                  <h2>{result.title}</h2>
                  <p>
                    Created by {result.author} · {date(result.date)}
                  </p>
                  <span className="field-label">Registration ID</span>
                  <code>{result.registration}</code>
                  <span className="field-label">
                    {result.seeded ? 'Sample identifier' : 'SHA-256 fingerprint'}
                  </span>
                  <code>{result.hash}</code>
                  <Link className="button small" to={'/artwork/' + result.id}>
                    View artwork <ArrowRight size={14} />
                  </Link>
                  {!result.seeded && (
                    <ChainRegistrationCard
                      key={`${result.id}:${d.user?.id || 'guest'}`}
                      artwork={result}
                    />
                  )}
                </div>
              ) : (
                <div className="registry-result">
                  <h3>No record found.</h3>
                  <p className="muted">
                    Check the ID or hash and try again. This only applies to this local registry.
                  </p>
                </div>
              ))}
          </div>
        </Form>
        <div className="panel registry-explainer">
          <span className="stat-icon">
            <Shield size={25} />
          </span>
          <h2>
            A fingerprint,
            <br />
            not a guess.
          </h2>
          <p>
            Each uploaded file receives a SHA-256 fingerprint. Even a tiny change creates a
            different hash.
          </p>
          <p className="muted small-text">
            This registry lives on your computer. It does not independently prove authorship.
          </p>
        </div>
      </div>
    </>
  );
}
