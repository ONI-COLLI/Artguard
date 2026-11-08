import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import type { FieldValues } from 'react-hook-form';
import { Form, Field, Submit, Modal } from './ui';
import { loginSchema, registerSchema } from '../../shared/schemas';
import { SocialAuth } from './social-auth';
import { useAction, useData, useFeedback, workspaceKey } from '../lib/workspace';
import type { Workspace } from '../../shared/types';
import { ForgotPasswordForm } from './account-security';
import { LegalFields } from './legal-consent';
interface DialogContextValue {
  open: (title: string, body: ReactNode) => void;
  close: () => void;
  auth: (mode?: 'login' | 'register', after?: () => void) => void;
}
const DialogContext = createContext<DialogContextValue | null>(null);
export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<{ title: string; body: ReactNode } | null>(null),
    location = useLocation();
  const close = () => setDialog(null);
  const open = (title: string, body: ReactNode) => setDialog({ title, body });
  const auth = (mode: 'login' | 'register' = 'login', after?: () => void) =>
    open(
      mode === 'login' ? 'Welcome back.' : 'Your next chapter starts here.',
      <AuthForm mode={mode} after={after} />,
    );
  useEffect(() => setDialog(null), [location.pathname]);
  return (
    <DialogContext value={{ open, close, auth }}>
      {children}
      {dialog && (
        <Modal title={dialog.title} onClose={close}>
          {dialog.body}
        </Modal>
      )}
    </DialogContext>
  );
}
export function useDialog() {
  const c = useContext(DialogContext);
  if (!c) throw new Error('DialogProvider missing');
  return c;
}
export function AuthForm({ mode, after }: { mode: 'login' | 'register'; after?: () => void }) {
  const action = useAction(`/auth/${mode}`),
    { close, auth, open } = useDialog(),
    { notify } = useFeedback(),
    client = useQueryClient();
  const { user, publicDemo } = useData();
  return (
    <>
      <p className="muted">
        {mode === 'login'
          ? user
            ? 'Switch the account in this tab. Your other tabs stay signed in.'
            : 'Sign in to your creative workspace.'
          : 'Create your own test workspace.'}
      </p>
      {after && <div className="auth-context">Sign in to continue where you left off.</div>}
      <SocialAuth />
      <Form
        key={mode}
        schema={mode === 'login' ? loginSchema : registerSchema}
        onSubmit={async (values: FieldValues) => {
          const next = (await action.mutateAsync(values)) as Workspace;
          if (user && next.user?.id !== user.id) {
            // Drop the previous account's queries, forms and wallet connection in this tab.
            window.location.reload();
            return;
          }
          await client.invalidateQueries({ queryKey: workspaceKey });
          close();
          notify({
            title: mode === 'login' ? 'Welcome back' : 'Your account is ready',
            detail: publicDemo
              ? 'Saved on the shared test server. This tab has its own session.'
              : 'Your workspace is saved on the local server.',
          });
          after?.();
        }}
      >
        {mode === 'register' && <Field name="name" label="Your name" maxLength={80} />}
        <Field name="email" label="Email address" type="email" placeholder="you@example.com" />
        <Field name="password" label="Password" type="password" />
        <p className="field-hint">Use at least 8 characters.</p>
        {mode === 'register' && <LegalFields />}
        <Submit pendingText={mode === 'login' ? 'Signing in…' : 'Creating account…'}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
          <ArrowRight size={16} />
        </Submit>
      </Form>
      {mode === 'login' && (
        <button
          className="text-button"
          onClick={() => open('Reset your password', <ForgotPasswordForm />)}
        >
          Forgot password?
        </button>
      )}
      <div className="auth-switch">
        {mode === 'login' ? 'New to ArtGuard?' : 'Already have an account?'}
        <button
          className="text-button"
          onClick={() => auth(mode === 'login' ? 'register' : 'login', after)}
        >
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </button>
      </div>
    </>
  );
}
export function AccessPanel() {
  const { auth } = useDialog();
  return (
    <div className="panel access-panel">
      <div className="eyebrow">Your next chapter starts here</div>
      <h2>
        A home for your
        <br />
        creative work.
      </h2>
      <p className="muted">
        Create an account to publish artwork, manage licenses, and track your sales.
      </p>
      <button className="primary" onClick={() => auth('register')}>
        Create an account
        <ArrowRight size={16} />
      </button>
      <button className="text-button" onClick={() => auth('login')}>
        Already a member? Sign in
      </button>
    </div>
  );
}
