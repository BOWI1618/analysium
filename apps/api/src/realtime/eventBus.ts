/**
 * In-process publish/subscribe for realtime events.
 *
 * The interface is deliberately narrow (publish / subscribe by workspace) so a
 * multi-node deployment can drop in a Redis or NATS implementation without any
 * service code changing: services only ever call `eventBus.publish(...)`.
 */
import { randomUUID } from 'node:crypto';
import type { RealtimeEvent, RealtimeEventType } from '@flowdesk/contracts';

export type EventListener = (event: RealtimeEvent) => void;

export interface EventBus {
  publish(event: RealtimeEvent): void;
  subscribe(workspaceId: string, listener: EventListener): () => void;
}

class InMemoryEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<EventListener>>();

  publish(event: RealtimeEvent): void {
    const set = this.listeners.get(event.workspaceId);
    if (!set) return;
    for (const listener of set) {
      // One misbehaving subscriber must not stop delivery to the others.
      try {
        listener(event);
      } catch {
        /* swallow: transport layer logs its own failures */
      }
    }
  }

  subscribe(workspaceId: string, listener: EventListener): () => void {
    let set = this.listeners.get(workspaceId);
    if (!set) {
      set = new Set();
      this.listeners.set(workspaceId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(workspaceId);
    };
  }

  /** Test helper. */
  subscriberCount(workspaceId: string): number {
    return this.listeners.get(workspaceId)?.size ?? 0;
  }
}

export const eventBus = new InMemoryEventBus();

type PayloadOf<T extends RealtimeEventType> = Extract<RealtimeEvent, { type: T }>['payload'];

/** Builds the envelope so call sites only supply type + payload. */
export function emit<T extends RealtimeEventType>(
  type: T,
  args: { workspaceId: string; actorId: string; payload: PayloadOf<T> },
): void {
  eventBus.publish({
    id: randomUUID(),
    type,
    workspaceId: args.workspaceId,
    actorId: args.actorId,
    at: new Date().toISOString(),
    payload: args.payload,
  } as RealtimeEvent);
}
