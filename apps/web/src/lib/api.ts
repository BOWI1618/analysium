/**
 * Typed HTTP client.
 *
 * One place converts a non-2xx response into an `ApiError` carrying the
 * server's error code and per-field messages, so every screen can render a
 * useful message instead of "something went wrong".
 */
import type { ApiErrorBody } from '@flowdesk/contracts';

export const API_BASE = '/api/v1';

/**
 * Identifies this browser tab for the lifetime of the page.
 *
 * Sent with every request and echoed back on realtime events, so a tab can
 * skip the echo of its own action — which it already applied optimistically —
 * while still reacting to everything else, including the same person working
 * in another tab or on their phone. Deliberately per-tab and in memory: a
 * value shared through localStorage would make two tabs indistinguishable
 * again, which is the whole problem it exists to solve.
 */
export const CLIENT_ID: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields ?? {};
    this.requestId = body.requestId;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isValidation(): boolean {
    return this.status === 422 || this.status === 400;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
}

export class NetworkError extends Error {
  /** The request was sent and nothing came back in time — as opposed to not getting through at all. */
  readonly timedOut: boolean;

  constructor(message = 'Сервер недоступен. Проверьте соединение и попробуйте ещё раз.', timedOut = false) {
    super(message);
    this.name = 'NetworkError';
    this.timedOut = timedOut;
  }
}

/**
 * How long a request may wait for an answer.
 *
 * There used to be no limit at all: with the server out of reach a list stayed
 * a skeleton for as long as the network itself took to give up — minutes — and
 * nothing on the screen said that anything was wrong. Changes get longer, and
 * the message for them says what is not known: whether the change was saved.
 * Uploads are exempt; a large file on a slow line is not a hung request.
 */
const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 60_000;

/**
 * The browser's own time zone, sent with every request. The screen draws dates
 * on this clock — «вчера», «сегодня», the red overdue plate — so the server
 * must count overdue and due-soon on the same one, or a figure and the list
 * under it disagree around midnight.
 */
const TIME_ZONE: string = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
})();

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

export function buildQuery(params: Query = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  query?: Query;
  /** FormData bypasses JSON encoding (file uploads). */
  formData?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, query, formData } = options;

  // One controller for both reasons to stop: the caller no longer wants the
  // answer (a query was replaced by a newer one), or the wait ran out.
  const controller = new AbortController();
  let timedOut = false;
  const timer = formData
    ? undefined
    : setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS,
      );
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', cancel);

  let response: Response;
  let text: string;
  try {
    response = await fetch(`${API_BASE}${path}${buildQuery(query)}`, {
      method,
      // Cookie-based sessions: the browser must send credentials.
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        ...(formData ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
        // Marks the call as a same-origin XHR; the server rejects
        // cross-origin state changes.
        'x-requested-with': 'flowdesk',
        'x-client-id': CLIENT_ID,
        ...(TIME_ZONE ? { 'x-time-zone': TIME_ZONE } : {}),
      },
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    // The body is part of the wait: headers can arrive and the rest never follow.
    text = response.status === 204 ? '' : await response.text();
  } catch (error) {
    if (timedOut) {
      throw new NetworkError(
        method === 'GET'
          ? 'Сервер не ответил за 30 секунд. Попробуйте ещё раз чуть позже.'
          : 'Сервер не ответил вовремя, и неизвестно, сохранилось ли изменение. Обновите страницу и проверьте.',
        true,
      );
    }
    if ((error as Error).name === 'AbortError') throw error;
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }

  if (response.status === 204) return undefined as T;

  const payload = text ? safeParse(text) : null;

  if (!response.ok) {
    const errorBody = (payload as ApiErrorBody | null)?.error ?? {
      code: 'INTERNAL',
      message: response.statusText || 'Запрос не прошёл',
    };
    throw new ApiError(response.status, errorBody);
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
};

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof NetworkError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Что-то пошло не так';
}
