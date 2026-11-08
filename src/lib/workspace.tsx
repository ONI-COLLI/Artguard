import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  useIsFetching,
  useIsMutating,
} from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, X, Clock, ArrowRight } from 'lucide-react';
import type { Workspace } from '../../shared/types';
import { api, ApiError } from './api';
export interface Notice {
  id: number;
  title: string;
  detail?: string;
  type?: 'success' | 'error' | 'info';
  href?: string;
  label?: string;
  time: Date;
}
interface Feedback {
  notify: (n: Omit<Notice, 'id' | 'time'>) => void;
  history: Notice[];
  dismiss: () => void;
}
const FeedbackContext = createContext<Feedback | null>(null);
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<Notice[]>([]),
    [notice, setNotice] = useState<Notice | null>(null);
  const notify = useCallback((n: Omit<Notice, 'id' | 'time'>) => {
    const v = { ...n, id: Date.now(), time: new Date() };
    setNotice(v);
    setHistory((h) => [v, ...h].slice(0, 10));
  }, []);
  useEffect(() => {
    if (!notice || notice.type === 'error') return;
    const timer = setTimeout(() => setNotice(null), notice.href ? 11000 : 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <FeedbackContext value={{ notify, history, dismiss: () => setNotice(null) }}>
      {children}
      {notice && (
        <div
          className={`toast feedback-toast feedback-${notice.type || 'success'}`}
          role={notice.type === 'error' ? 'alert' : 'status'}
        >
          <span className="feedback-symbol">
            {notice.type === 'error' ? (
              <X size={15} />
            ) : notice.type === 'info' ? (
              <Clock size={15} />
            ) : (
              <Check size={15} />
            )}
          </span>
          <div className="feedback-copy">
            <strong>{notice.title}</strong>
            {notice.detail && <p>{notice.detail}</p>}
            {notice.href && (
              <Link to={notice.href} onClick={() => setNotice(null)}>
                {notice.label || 'View details'}
                <ArrowRight size={13} />
              </Link>
            )}
          </div>
          <button
            className="icon-button small"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </FeedbackContext>
  );
}
export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('FeedbackProvider missing');
  return context;
}
export const workspaceKey = ['workspace'] as const;
export function useWorkspace() {
  return useQuery({
    queryKey: workspaceKey,
    queryFn: ({ signal }) => api<Workspace>('/state', { signal }),
    staleTime: 30000,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.purchases.some((p) => p.validUntil && !p.expired)
        ? 30000
        : query.state.data?.user?.subscription?.plan &&
            query.state.data.user.subscription.plan !== 'free'
          ? 60000
          : false,
  });
}
export function useData() {
  const { data } = useWorkspace();
  if (!data) throw new Error('Workspace is not loaded');
  return data;
}
export function useAction<T = unknown>(path: string, method = 'POST') {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: T) => api<Workspace>(path, { method, data }),
    onSuccess: async (next) => {
      if (next.artworks) client.setQueryData(workspaceKey, next);
      else await client.invalidateQueries({ queryKey: workspaceKey });
    },
  });
}
export function useBusy() {
  return useIsFetching() + useIsMutating() > 0;
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
export function useDownload() {
  const { notify } = useFeedback();
  const [pending, setPending] = useState(false);
  return {
    pending,
    run: async (path: string) => {
      setPending(true);
      try {
        const { download } = await import('./api');
        await download(path);
        notify({
          title: 'Download started',
          detail: 'Your browser will save the file to your downloads folder.',
        });
      } catch (error) {
        notify({
          title: 'Download could not be prepared',
          detail: errorText(error),
          type: 'error',
        });
      } finally {
        setPending(false);
      }
    },
  };
}
export { ApiError };
