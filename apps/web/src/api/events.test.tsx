import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activity, inbox, reviewSummary } from '@/mocks/fixtures';
import { applyEvent, useEvents } from './events';
import { keys } from './hooks';

const client = () => new QueryClient();

describe('applyEvent', () => {
  it('replaces the inbox row review for that PR and invalidates the review', () => {
    const qc = client();
    qc.setQueryData(keys.inbox, inbox);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    applyEvent(qc, {
      type: 'review.updated',
      data: reviewSummary('reviewing', { id: 'rev_x', number: 130 }),
    });
    const row = qc
      .getQueryData<typeof inbox>(keys.inbox)!
      .find((i) => i.pr.number === 130)!;
    expect(row.latestReview).toMatchObject({
      id: 'rev_x',
      status: 'reviewing',
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['review', 'rev_x'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: keys.inbox });
  });

  it('refetches the inbox when the PR is not listed', () => {
    const qc = client();
    qc.setQueryData(keys.inbox, inbox);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    applyEvent(qc, {
      type: 'review.updated',
      data: reviewSummary('queued', { number: 9999 }),
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.inbox });
  });

  it('stores poll status and updates the health poller times', () => {
    const qc = client();
    qc.setQueryData(keys.health, {
      poller: { enabled: true },
      gh: { authenticated: true },
    });
    applyEvent(qc, {
      type: 'poll.status',
      data: { state: 'idle', lastRunAt: 'L', nextRunAt: 'N' },
    });
    expect(qc.getQueryData(keys.pollStatus)).toMatchObject({ state: 'idle' });
    expect(qc.getQueryData(keys.health)).toMatchObject({
      poller: { enabled: true, lastRunAt: 'L', nextRunAt: 'N' },
    });
  });

  it('prepends new activity once', () => {
    const qc = client();
    const key = [...keys.activity, 'list'];
    qc.setQueryData(key, {
      pages: [{ items: activity }],
      pageParams: [undefined],
    });
    const entry = { ...activity[0]!, id: 'new' };
    applyEvent(qc, { type: 'activity.created', data: entry });
    applyEvent(qc, { type: 'activity.created', data: entry });
    const data = qc.getQueryData<{ pages: { items: { id: string }[] }[] }>(
      key,
    )!;
    expect(data.pages[0]!.items.map((i) => i.id)).toEqual([
      'new',
      ...activity.map((a) => a.id),
    ]);
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (m: { data: string }) => void>();
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (m: { data: string }) => void) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
  }
}

function Harness({ qc }: { qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>
  );
}
function Probe() {
  useEvents('/api/events');
  return null;
}

describe('useEvents', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeEventSource.instances = [];
  });

  it('applies envelope and named events, ignores junk, and closes on unmount', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const qc = client();
    const { unmount } = render(<Harness qc={qc} />);
    const [es] = FakeEventSource.instances;
    es!.onmessage!({
      data: JSON.stringify({
        type: 'poll.status',
        data: { state: 'running' },
      }),
    });
    expect(qc.getQueryData(keys.pollStatus)).toMatchObject({
      state: 'running',
    });
    es!.listeners.get('poll.status')!({
      data: JSON.stringify({ state: 'idle' }),
    });
    expect(qc.getQueryData(keys.pollStatus)).toMatchObject({ state: 'idle' });
    es!.onmessage!({ data: 'not json' });
    es!.onmessage!({ data: JSON.stringify({ type: 'nope', data: {} }) });
    expect(qc.getQueryData(keys.pollStatus)).toMatchObject({ state: 'idle' });
    unmount();
    expect(es!.closed).toBe(true);
  });

  it('reconnects with backoff and refetches everything once back', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const qc = client();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(<Harness qc={qc} />);
    FakeEventSource.instances[0]!.onopen!();
    expect(spy).not.toHaveBeenCalled();

    FakeEventSource.instances[0]!.onerror!();
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances[1]!.onerror!();
    vi.advanceTimersByTime(1_999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    FakeEventSource.instances[2]!.onopen!();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
