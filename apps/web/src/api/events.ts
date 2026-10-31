import {
  ServerEventSchema,
  type HealthResponse,
  type InboxItem,
  type ServerEvent,
} from '@pr-reviewer/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { keys } from './hooks';
import type { ActivityPage, PollStatus } from './types';

/** Pushes one server event into the TanStack Query caches. */
export function applyEvent(qc: QueryClient, event: ServerEvent): void {
  switch (event.type) {
    case 'review.updated': {
      const review = event.data;
      let matched = false;
      qc.setQueryData<InboxItem[]>(keys.inbox, (items) =>
        items?.map((item) => {
          if (item.pr.repo !== review.repo || item.pr.number !== review.number)
            return item;
          matched = true;
          return {
            ...item,
            latestReview: review,
            isStale: review.status === 'stale',
          };
        }),
      );
      // A review for a PR the inbox doesn't list yet (manual review): refetch.
      if (!matched) void qc.invalidateQueries({ queryKey: keys.inbox });
      void qc.invalidateQueries({ queryKey: ['review', review.id] });
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      return;
    }
    case 'inbox.updated':
      void qc.invalidateQueries({ queryKey: keys.inbox });
      return;
    case 'poll.status': {
      const status: PollStatus = event.data;
      qc.setQueryData(keys.pollStatus, status);
      qc.setQueryData<HealthResponse>(keys.health, (health) =>
        health
          ? {
              ...health,
              poller: {
                ...health.poller,
                ...(status.lastRunAt ? { lastRunAt: status.lastRunAt } : {}),
                ...(status.nextRunAt ? { nextRunAt: status.nextRunAt } : {}),
              },
            }
          : health,
      );
      return;
    }
    case 'activity.created': {
      const entry = event.data;
      qc.setQueriesData<ActivityPage>({ queryKey: keys.activity }, (data) =>
        data && data.pages.length
          ? data.pages.some((p) => p.items.some((i) => i.id === entry.id))
            ? data
            : {
                ...data,
                pages: data.pages.map((page, i) =>
                  i === 0 ? { ...page, items: [entry, ...page.items] } : page,
                ),
              }
          : data,
      );
      return;
    }
  }
}

const EVENT_TYPES = [
  'review.updated',
  'inbox.updated',
  'poll.status',
  'activity.created',
] as const satisfies readonly ServerEvent['type'][];

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/**
 * One SSE connection for the app. Reconnects with exponential backoff, and refetches
 * everything after a reconnect because events may have been missed in between.
 */
export function useEvents(url = '/api/events'): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = MIN_DELAY_MS;
    let hasConnected = false;
    let stopped = false;

    const connect = () => {
      source = new EventSource(url);
      source.onopen = () => {
        delay = MIN_DELAY_MS;
        if (hasConnected) void qc.invalidateQueries();
        hasConnected = true;
      };
      const handle = (raw: string, type?: ServerEvent['type']) => {
        try {
          const json: unknown = JSON.parse(raw);
          const parsed = ServerEventSchema.safeParse(
            type ? { type, data: json } : json,
          );
          if (parsed.success) applyEvent(qc, parsed.data);
        } catch {
          // Ignore malformed frames; the heartbeat is a comment and never reaches here.
        }
      };
      // The wire format isn't pinned down: accept a `{type, data}` envelope on the default
      // message channel, or the payload alone under a named SSE event.
      source.onmessage = (message: MessageEvent<string>) =>
        handle(message.data);
      for (const type of EVENT_TYPES)
        source.addEventListener(type, (message) =>
          handle((message as MessageEvent<string>).data, type),
        );
      source.onerror = () => {
        source?.close();
        if (stopped) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [qc, url]);
}
