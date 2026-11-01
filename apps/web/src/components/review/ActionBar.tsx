import type { ReviewDetail } from '@pr-reviewer/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDismissReview, useRerunReview } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { usePublishFlow } from './PublishFlow';
import { isEditable } from './StatusBadge';

/** Counts, Rerun, Dismiss, and the publish flow (pending by default; submit needs confirmation). */
export function ActionBar({ review }: { review: ReviewDetail }) {
  const rerun = useRerunReview(review.id);
  const dismiss = useDismissReview(review.id);
  const toast = useToast();
  const navigate = useNavigate();
  const doRerun = () =>
    rerun.mutate(undefined, {
      onSuccess: (r) => {
        toast.success('Re-running review');
        navigate(`/reviews/${r.id}`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  const flow = usePublishFlow(review, { onRerun: doRerun });
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const blockers = review.comments.filter(
    (c) => c.included && c.severity === 'blocker',
  ).length;
  const excluded = review.comments.filter((c) => !c.included).length;
  const active = isEditable(review.status);

  return (
    <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-background py-3">
      <p className="text-sm">
        {review.comments.length} comments · {blockers} blockers · {excluded}{' '}
        excluded
      </p>
      <p className="hidden text-xs text-muted-foreground xl:block">
        <kbd>j</kbd>/<kbd>k</kbd> next/previous comment · <kbd>⌘</kbd>
        <kbd>↵</kbd> save
      </p>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" disabled={rerun.isPending} onClick={doRerun}>
          Rerun
        </Button>
        {active ? (
          <>
            <Button variant="outline" onClick={() => setConfirmDismiss(true)}>
              Dismiss
            </Button>
            <Button
              variant="outline"
              disabled={flow.isPending}
              onClick={flow.requestSubmit}
            >
              Submit now…
            </Button>
            <Button disabled={flow.isPending} onClick={flow.publishPending}>
              {flow.isPending ? 'Publishing…' : 'Publish as pending review'}
            </Button>
          </>
        ) : review.github ? (
          <Button asChild variant="outline">
            <a href={review.github.url} target="_blank" rel="noreferrer">
              Open on GitHub
            </a>
          </Button>
        ) : null}
      </div>
      {flow.dialogs}
      <ConfirmDialog
        open={confirmDismiss}
        title="Dismiss this review?"
        description="The draft is kept in History but will not be published."
        confirmLabel="Dismiss"
        destructive
        onCancel={() => setConfirmDismiss(false)}
        onConfirm={() => {
          setConfirmDismiss(false);
          dismiss.mutate(undefined, {
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
    </div>
  );
}
