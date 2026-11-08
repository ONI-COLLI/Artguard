import { SocialAuth } from './social-auth';
import { DemoMailbox } from './demo-mailbox';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { z } from 'zod';
import { Form, Field, Submit, Button, PageHeading } from './ui';
import { api } from '../lib/api';
import { useData, useFeedback, workspaceKey } from '../lib/workspace';
export function ForgotPasswordForm() {
  const request = useMutation({
    mutationFn: (email: string) =>
      api<{ message: string }>('/auth/forgot-password', { method: 'POST', data: { email } }),
  });
  return (
    <>
      <p className="muted">
        Request a single-use password reset link. This local build stores messages in the local mail
        outbox.
      </p>
      <Form
        schema={z.object({ email: z.email().max(254) })}
        onSubmit={async (v) => {
          await request.mutateAsync(v.email);
        }}
      >
        <Field name="email" label="Account email" type="email" />
        <Submit>Request reset link</Submit>
      </Form>
      {request.data && (
        <div className="local-note" role="status">
          {request.data.message}
          <p>
            Read it in the project terminal: <code>npm run mail -- --email your-address</code>
          </p>
        </div>
      )}
    </>
  );
}
export function AccountSecurity() {
  const { user, publicDemo } = useData(),
    { notify } = useFeedback(),
    send = useMutation({
      mutationFn: () => api('/auth/resend-verification', { method: 'POST', data: {} }),
      onSuccess: () =>
        notify({
          title: 'Verification message saved',
          detail: publicDemo
            ? 'Open your private demo inbox below.'
            : 'Read the local mail outbox in the project terminal.',
        }),
    });
  return (
    <>
      <PageHeading kicker="Account security" title="Keep your account yours." />
      <div className="panel form-panel">
        {user ? (
          <>
            <h2>{user.emailVerified ? 'Email verified' : 'Verify your email'}</h2>
            <p>{user.email}</p>
            <p className="muted small-text">
              Verify your email before publishing, purchasing a subscription or license, and
              approving co-author shares.
            </p>
            {!user.emailVerified && (
              <Button className="primary" busy={send.isPending} onClick={() => send.mutate()}>
                Send verification message
              </Button>
            )}
            {send.error && (
              <p className="form-error" role="alert">
                {send.error.message}
              </p>
            )}
            {publicDemo ? (
              <DemoMailbox />
            ) : (
              <div className="local-note">
                <strong>Local mail outbox</strong>
                <p>
                  This development build saves email locally and does not send external messages. In
                  the project terminal, run:
                </p>
                <code>npm run mail -- --email {user.email}</code>
                <p>
                  Open the verification or reset link from that message. Anyone with terminal access
                  to this computer can read the development mailbox.
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="muted">
            Sign in to verify your current email, or request a password reset below.
          </p>
        )}
        {user && (
          <>
            <h3>Connected sign-in providers</h3>
            <p className="muted small-text">
              Use the same account to buy licenses and publish projects. Connecting a sign-in
              provider does not connect a crypto wallet.
            </p>
            <SocialAuth link />
          </>
        )}
        <h3>Password recovery</h3>
        <ForgotPasswordForm />
      </div>
    </>
  );
}
export function EmailAction({ mode }: { mode: 'verify' | 'reset' }) {
  const [params, setParams] = useSearchParams(),
    token = params.get('token'),
    client = useQueryClient(),
    { notify } = useFeedback();
  const previousToken = useRef(token);
  const action = useMutation({
    mutationFn: (password?: string) =>
      api(mode === 'verify' ? '/auth/verify-email' : '/auth/reset-password', {
        method: 'POST',
        data: { token, ...(password ? { password } : {}) },
      }),
    onSuccess: async () => {
      setParams({}, { replace: true });
      await client.invalidateQueries({ queryKey: workspaceKey });
      notify({
        title: mode === 'verify' ? 'Email verified' : 'Password reset',
        detail:
          mode === 'reset'
            ? 'All previous sessions have been signed out. Sign in with your new password.'
            : 'Your account can now publish, purchase, and approve shares.',
      });
    },
  });
  useEffect(() => {
    if (token && token !== previousToken.current) {
      previousToken.current = token;
      action.reset();
    }
  }, [token, action.reset]);
  return (
    <>
      <PageHeading
        kicker="Account security"
        title={mode === 'verify' ? 'Verify your email.' : 'Choose a new password.'}
      />
      <div className="panel form-panel">
        {action.isSuccess ? (
          <>
            <p role="status">
              {mode === 'verify'
                ? 'Email verified successfully.'
                : 'Password reset. Sign in again with your new password.'}
            </p>
            <Link className="button primary" to="/settings">
              Continue to your account
            </Link>
          </>
        ) : !token || !/^[a-f0-9]{64}$/.test(token) ? (
          <>
            <p className="form-error">This link is missing or invalid.</p>
            <Link to="/security">Request a new link</Link>
          </>
        ) : mode === 'verify' ? (
          <>
            <p>Confirm that this local mailbox belongs to your account.</p>
            <Button
              className="primary"
              busy={action.isPending}
              onClick={() => action.mutate(undefined)}
            >
              Verify email
            </Button>
            {action.error && (
              <>
                <p role="alert" className="form-error">
                  {action.error.message}
                </p>
                <Link to="/security">Request a new link</Link>
              </>
            )}
          </>
        ) : (
          <Form
            schema={z
              .object({ password: z.string().min(8).max(128), confirm: z.string() })
              .refine((v) => v.password === v.confirm, {
                message: 'Passwords must match.',
                path: ['confirm'],
              })}
            onSubmit={async (v) => {
              await action.mutateAsync(v.password);
            }}
          >
            <Field name="password" label="New password" type="password" />
            <Field name="confirm" label="Confirm new password" type="password" />
            <Submit>Reset password and sign out all sessions</Submit>
          </Form>
        )}
      </div>
    </>
  );
}
