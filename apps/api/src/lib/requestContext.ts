/**
 * Per-request ambient context.
 *
 * Carries the calling browser tab's id so realtime events can name the client
 * that caused them without every service threading the value through its
 * signature. `emit` is the only reader; route handlers stay unaware of it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Value of the `x-client-id` header, when the caller sent one. */
  clientId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentClientId(): string | undefined {
  return storage.getStore()?.clientId;
}
