import { sessionUrl } from './session';
import type { ApiErrorBody } from '../../shared/types';
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
export interface UploadProgress {
  percent: number;
  processing: boolean;
}
export async function api<T>(
  path: string,
  {
    method = 'GET',
    data,
    signal,
    onProgress,
  }: {
    method?: string;
    data?: unknown;
    signal?: AbortSignal;
    onProgress?: (p: UploadProgress) => void;
  } = {},
): Promise<T> {
  if (data instanceof FormData && onProgress) return upload<T>(path, data, onProgress, method);
  let response: Response;
  try {
    response = await fetch(sessionUrl('/api' + path), {
      method,
      credentials: 'same-origin',
      signal: signal || AbortSignal.timeout(30000),
      headers:
        data === undefined || data instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      'Cannot reach the local server. Your changes have not been confirmed. Please reconnect and try again.',
    );
  }
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: 'The request failed.' }))) as ApiErrorBody;
    throw new ApiError(body.error, response.status, body.fields);
  }
  return response.json() as Promise<T>;
}
function upload<T>(
  path: string,
  data: FormData,
  onProgress: (p: UploadProgress) => void,
  method: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, sessionUrl('/api' + path));
    xhr.timeout = 120000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress({ percent: Math.round((e.loaded / e.total) * 100), processing: false });
    };
    xhr.upload.onload = () => onProgress({ percent: 100, processing: true });
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
        else reject(new ApiError(body.error, xhr.status, body.fields));
      } catch {
        reject(new ApiError('The response could not be read. Check My artwork before retrying.'));
      }
    };
    xhr.onerror = xhr.ontimeout = () =>
      reject(new ApiError('Upload not confirmed. Reconnect and check My artwork before retrying.'));
    xhr.send(data);
  });
}
export async function download(path: string) {
  let response: Response;
  try {
    response = await fetch(sessionUrl(path), { credentials: 'same-origin' });
  } catch {
    throw new ApiError('Cannot reach the local server.');
  }
  if (!response.ok) {
    const v = (await response.json()) as ApiErrorBody;
    throw new ApiError(v.error, response.status);
  }
  const blob = await response.blob(),
    url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  link.download = encoded
    ? decodeURIComponent(encoded[1])
    : /filename="?([^";]+)/.exec(disposition)?.[1] || 'artguard-download';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
