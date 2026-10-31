import { ServerEventSchema, type ServerEvent } from '@pr-reviewer/shared';

export type EventListener = (event: ServerEvent) => void;

export class EventHub {
  private readonly listeners = new Set<EventListener>();

  publish(event: ServerEvent) {
    const parsed = ServerEventSchema.parse(event);
    for (const listener of this.listeners) listener(parsed);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
