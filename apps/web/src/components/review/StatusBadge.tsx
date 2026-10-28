import type { ReviewStatus } from '@pr-reviewer/shared';
import { Badge } from '@/components/ui/badge';

const labels: Record<ReviewStatus, string> = {
  queued: 'Queued',
  gathering: 'Gathering',
  reviewing: 'Reviewing',
  draft_ready: 'Draft ready',
  stale: 'Stale',
  publishing: 'Publishing',
  published_pending: 'Pending on GitHub',
  submitted: 'Submitted',
  dismissed: 'Dismissed',
  failed: 'Failed',
};

const variants: Record<
  ReviewStatus,
  'default' | 'success' | 'warning' | 'destructive'
> = {
  queued: 'default',
  gathering: 'default',
  reviewing: 'default',
  draft_ready: 'success',
  stale: 'warning',
  publishing: 'default',
  published_pending: 'success',
  submitted: 'success',
  dismissed: 'default',
  failed: 'destructive',
};

export const IN_PROGRESS_STATUSES: ReviewStatus[] = [
  'queued',
  'gathering',
  'reviewing',
];
export const isEditable = (status: ReviewStatus) =>
  status === 'draft_ready' || status === 'stale';

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}
