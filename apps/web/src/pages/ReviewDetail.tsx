import { RefreshCw } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useRerunReview, useReview, useReviewDiff } from '@/api/hooks';
import { ErrorState, LoadingState } from '@/components/ErrorState';
import { ChatBar } from '@/components/review/ChatBar';
import { ActionBar } from '@/components/review/ActionBar';
import { CommentList } from '@/components/review/CommentList';
import { DiffView } from '@/components/review/DiffView';
import { ReviewHeader } from '@/components/review/ReviewHeader';
import { ReviewRail, SummaryEditor } from '@/components/review/ReviewRail';
import { ReviewTabs, type ReviewTab } from '@/components/review/ReviewTabs';
import {
  IN_PROGRESS_STATUSES,
  isEditable,
} from '@/components/review/StatusBadge';
import { Button } from '@/components/ui/button';
import { useCommentShortcuts } from '@/lib/useCommentShortcuts';

export function ReviewDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab: ReviewTab =
    params.get('tab') === 'changes' ? 'changes' : 'summary';
  const review = useReview(id);
  const ready =
    !!review.data && !IN_PROGRESS_STATUSES.includes(review.data.status);
  const diff = useReviewDiff(ready ? id : '');
  const rerun = useRerunReview(id);
  useCommentShortcuts(!!review.data);

  if (review.isPending)
    return (
      <div className="p-4 md:p-8">
        <LoadingState label="Loading review…" />
      </div>
    );
  if (review.isError)
    return review.error instanceof ApiError &&
      review.error.code === 'GH_NOT_FOUND' ? (
      <div className="space-y-2 p-4 md:p-8">
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
      <div className="space-y-4 p-4 md:p-8">
        <ReviewHeader review={data} />
        <p role="status" className="flex items-center gap-2 text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Review is {data.status}… this page updates automatically.
        </p>
      </div>
    );

  if (data.status === 'failed')
    return (
      <div className="space-y-4 p-4 md:p-8">
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
  const setTab = (next: ReviewTab) =>
    setParams(next === 'summary' ? {} : { tab: next }, { replace: true });
  return (
    <div>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-8">
        <ReviewTabs
          tab={tab}
          onChange={setTab}
          additions={data.pr.additions}
          deletions={data.pr.deletions}
        />
        <ActionBar review={data} />
      </div>
      <div className="space-y-6 px-4 py-6 md:px-8">
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
        {tab === 'summary' ? (
          <div className="flex flex-col gap-8 lg:flex-row">
            <div className="min-w-0 flex-1 space-y-8">
              <ReviewHeader review={data} />
              <SummaryEditor review={data} editable={editable} />
              <CommentList
                reviewId={data.id}
                comments={data.comments}
                editable={editable}
              />
              <p className="text-xs text-muted-foreground">
                <kbd>j</kbd>/<kbd>k</kbd> next/previous comment · <kbd>⌘</kbd>
                <kbd>↵</kbd> save ·{' '}
                <Link to="/projects" className="underline">
                  Rules
                </Link>{' '}
                for {data.repo} decide what is checked.
              </p>
            </div>
            <ReviewRail review={data} editable={editable} />
          </div>
        ) : diff.isPending ? (
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
      <ChatBar key={data.id} reviewId={data.id} prNumber={data.number} />
    </div>
  );
}
