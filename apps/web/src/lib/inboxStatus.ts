import type { InboxItem, ReviewStatus } from '@pr-reviewer/shared';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive';

/** What the Inbox row's action button does; the page maps each kind to a link or a mutation. */
export type InboxAction =
  | { kind: 'link'; label: string; to: string }
  | { kind: 'external'; label: string; href: string }
  | { kind: 'review'; label: string }
  | { kind: 'retry'; label: string; reviewId: string; error?: string }
  | { kind: 'progress'; label: string };

export interface InboxRowState {
  badge: { label: string; variant: BadgeVariant };
  /** Shown next to the badge when the draft is out of date. */
  stale: boolean;
  action: InboxAction;
}

const statusBadge: Record<
  ReviewStatus,
  { label: string; variant: BadgeVariant }
> = {
  queued: { label: 'Queued', variant: 'default' },
  gathering: { label: 'Gathering', variant: 'default' },
  reviewing: { label: 'Reviewing', variant: 'default' },
  draft_ready: { label: 'Draft ready', variant: 'success' },
  stale: { label: 'Stale', variant: 'warning' },
  publishing: { label: 'Publishing', variant: 'default' },
  published_pending: { label: 'Pending on GitHub', variant: 'success' },
  submitted: { label: 'Submitted', variant: 'success' },
  dismissed: { label: 'Dismissed', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
};

export function inboxRowState(item: InboxItem): InboxRowState {
  const rulesLink = `/projects/${item.pr.repo}`;
  if (item.rulesState === 'none')
    return {
      badge: { label: 'No rules', variant: 'default' },
      stale: false,
      action: { kind: 'link', label: 'Add rules', to: rulesLink },
    };
  if (item.rulesState === 'invalid')
    return {
      badge: { label: 'Rules invalid', variant: 'destructive' },
      stale: false,
      action: { kind: 'link', label: 'Fix rules', to: rulesLink },
    };
  if (item.rulesState === 'disabled')
    return {
      badge: { label: 'Rules disabled', variant: 'default' },
      stale: false,
      action: { kind: 'link', label: 'Open rules', to: rulesLink },
    };

  const review = item.latestReview;
  if (!review)
    return {
      badge: { label: 'Not reviewed', variant: 'default' },
      stale: false,
      action: { kind: 'review', label: 'Review now' },
    };

  const stale = item.isStale || review.status === 'stale';
  const badge = stale ? statusBadge.stale : statusBadge[review.status];
  const open = `/reviews/${review.id}`;
  switch (review.status) {
    case 'draft_ready':
    case 'stale':
      return {
        badge,
        stale,
        action: { kind: 'link', label: 'Open draft', to: open },
      };
    case 'queued':
    case 'gathering':
    case 'reviewing':
      return {
        badge,
        stale,
        action: {
          kind: 'progress',
          label: `${statusBadge[review.status].label}…`,
        },
      };
    case 'publishing':
      return {
        badge,
        stale,
        action: { kind: 'progress', label: 'Publishing…' },
      };
    case 'failed':
      return {
        badge,
        stale,
        action: {
          kind: 'retry',
          label: 'Retry',
          reviewId: review.id,
          ...(review.error ? { error: review.error } : {}),
        },
      };
    case 'published_pending':
      return {
        badge,
        stale,
        action: {
          kind: 'external',
          label: 'Open on GitHub',
          href: item.pr.url,
        },
      };
    case 'submitted':
      return {
        badge,
        stale: false,
        action: { kind: 'link', label: 'View review', to: open },
      };
    case 'dismissed':
      return {
        badge,
        stale: false,
        action: { kind: 'review', label: 'Review again' },
      };
  }
}
