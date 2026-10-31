import { describe, expect, it } from 'vitest';
import { inbox } from '@/mocks/fixtures';
import { inboxRowState } from './inboxStatus';

const byNumber = (n: number) => inbox.find((i) => i.pr.number === n)!;

describe('inboxRowState', () => {
  it('sends repos without valid rules to the project editor', () => {
    expect(inboxRowState(byNumber(9))).toMatchObject({
      badge: { label: 'No rules', variant: 'default' },
      action: { kind: 'link', label: 'Add rules', to: '/projects/acme/tools' },
    });
    expect(inboxRowState(byNumber(55))).toMatchObject({
      badge: { label: 'Rules invalid', variant: 'destructive' },
      action: { label: 'Fix rules', to: '/projects/acme/web' },
    });
    expect(inboxRowState(byNumber(3)).action).toMatchObject({
      label: 'Open rules',
    });
  });

  it('offers "Review now" when valid rules exist but nothing was reviewed', () => {
    expect(inboxRowState(byNumber(130))).toMatchObject({
      badge: { label: 'Not reviewed' },
      action: { kind: 'review', label: 'Review now' },
    });
  });

  it('opens a ready draft and overlays Stale when the PR moved on', () => {
    expect(inboxRowState(byNumber(128))).toMatchObject({
      badge: { label: 'Draft ready' },
      stale: false,
      action: {
        kind: 'link',
        label: 'Open draft',
        to: '/reviews/rev_draft_ready',
      },
    });
    expect(inboxRowState(byNumber(129))).toMatchObject({
      badge: { label: 'Stale', variant: 'warning' },
      stale: true,
      action: { label: 'Open draft' },
    });
    const movedOn = { ...byNumber(128), isStale: true };
    expect(inboxRowState(movedOn)).toMatchObject({
      badge: { label: 'Stale' },
      stale: true,
    });
  });

  it('shows disabled progress while a review is generating', () => {
    for (const status of ['queued', 'gathering', 'reviewing'] as const) {
      const item = {
        ...byNumber(128),
        latestReview: { ...byNumber(128).latestReview!, status },
      };
      expect(inboxRowState(item).action.kind).toBe('progress');
    }
  });

  it('offers Retry with the error for failed reviews', () => {
    expect(inboxRowState(byNumber(131)).action).toMatchObject({
      kind: 'retry',
      reviewId: 'rev_failed',
      error: 'LLM output failed validation after one retry',
    });
  });

  it('links published pending reviews to GitHub', () => {
    expect(inboxRowState(byNumber(132)).action).toMatchObject({
      kind: 'external',
      label: 'Open on GitHub',
    });
  });
});
