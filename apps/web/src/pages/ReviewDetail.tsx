import { RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useRerunReview, useReview, useReviewDiff } from '@/api/hooks';
import { ErrorState, LoadingState } from '@/components/ErrorState';
import { ActionBar } from '@/components/review/ActionBar';
import { DiffView } from '@/components/review/DiffView';
import { ReviewHeader } from '@/components/review/ReviewHeader';
import { ReviewRail } from '@/components/review/ReviewRail';
import {
  IN_PROGRESS_STATUSES,
  isEditable,
} from '@/components/review/StatusBadge';
import { Button } from '@/components/ui/button';
import { useCommentShortcuts } from '@/lib/useCommentShortcuts';

export function ReviewDetail() {
  const { id = '' } = useParams();
  const review = useReview(id);
  const ready =
    !!review.data && !IN_PROGRESS_STATUSES.includes(review.data.status);
  const diff = useReviewDiff(ready ? id : '');
  const rerun = useRerunReview(id);
  useCommentShortcuts(!!review.data);

  if (review.isPending) return <LoadingState label="Loading review…" />;
  if (review.isError)
    return review.error instanceof ApiError &&
      review.error.code === 'GH_NOT_FOUND' ? (
      <div className="space-y-2">
        <ErrorState error={review.error} />
        <Link to="/" className="text-sm underline">
          Back to Inbox
        </Link>
      </div>
    ) : (
      <ErrorState error={review.error} onRetry={() => review.refetch()} />
    );
  const data = review.data;

  if (IN_PROGRESS_STATUSES.includes(data.status))
    return (
      <div className="space-y-4">
        <ReviewHeader review={data} />
        <p role="status" className="flex items-center gap-2 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Review is {data.status}… this page updates automatically.
        </p>
      </div>
    );

  if (data.status === 'failed')
    return (
      <div className="space-y-4">
        <ReviewHeader review={data} />
        <div
          role="alert"
          className="rounded-md border border-destructive/40 p-4 text-sm"
        >
          <p className="font-medium">The review failed</p>
          <p>{data.error ?? 'Unknown error.'}</p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            disabled={rerun.isPending}
            onClick={() => rerun.mutate()}
          >
            Retry
          </Button>
        </div>
      </div>
    );

  const editable = isEditable(data.status);
  return (
    <div className="space-y-4">
      <ReviewHeader review={data} />
      {data.status === 'stale' ? (
        <div
          role="alert"
          className="flex items-center justify-between rounded-md border border-warning/50 bg-warning/20 p-3 text-sm"
        >
          New commits since this draft
          <Button size="sm" variant="outline" onClick={() => rerun.mutate()}>
            Re-run review
          </Button>
        </div>
      ) : null}
      {!editable ? (
        <p className="text-sm text-muted-foreground">
          This review is read-only.
        </p>
      ) : null}
      <div className="flex gap-6">
        <ReviewRail review={data} editable={editable} />
        <div className="min-w-0 flex-1">
          {diff.isPending ? (
            <LoadingState label="Loading diff…" />
          ) : diff.isError ? (
            <ErrorState error={diff.error} onRetry={() => diff.refetch()} />
          ) : (
            <DiffView
              reviewId={data.id}
              files={diff.data}
              comments={data.comments}
              editable={editable}
            />
          )}
        </div>
      </div>
      <ActionBar review={data} />
      <p className="text-xs text-muted-foreground">
        <Link to="/projects" className="underline">
          Rules
        </Link>{' '}
        for {data.repo} decide what is checked.
      </p>
    </div>
  );
}
