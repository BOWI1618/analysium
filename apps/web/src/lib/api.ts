/**
 * Typed HTTP client.
 *
 * One place converts a non-2xx response into an `ApiError` carrying the
 * server's error code and per-field messages, so every screen can render a
 * useful message instead of "something went wrong".
 */
import type { ApiErrorBody } from '@flowdesk/contracts';

export const API_BASE = '/api/v1';

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
  constructor() {
    super('Сервер недоступен. Проверьте соединение и попробуйте ещё раз.');
    this.name = 'NetworkError';
  }
}

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

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}${buildQuery(query)}`, {
      method,
      // Cookie-based sessions: the browser must send credentials.
      credentials: 'same-origin',
      signal,
      headers: {
        ...(formData ? {} : body !== undefined ? { 'content-type': 'application/json' } : {}),
        // Marks the call as a same-origin XHR; the server rejects
        // cross-origin state changes.
        'x-requested-with': 'flowdesk',
      },
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new NetworkError();
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
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
