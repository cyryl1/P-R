import type { ReviewDetail } from '@pr-reviewer/shared';
import { useState } from 'react';
import { useDismissReview, useRerunReview } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { isEditable } from './StatusBadge';

/** Phase 2 bar: counts, Rerun, Dismiss. Publish and Submit arrive in Phase 3. */
export function ActionBar({ review }: { review: ReviewDetail }) {
  const rerun = useRerunReview(review.id);
  const dismiss = useDismissReview(review.id);
  const toast = useToast();
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
      <div className="ml-auto flex gap-2">
        <Button
          variant="outline"
          disabled={rerun.isPending}
          onClick={() =>
            rerun.mutate(undefined, {
              onSuccess: () => toast.success('Re-running review'),
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        >
          Rerun
        </Button>
        {active ? (
          <Button variant="outline" onClick={() => setConfirmDismiss(true)}>
            Dismiss
          </Button>
        ) : null}
      </div>
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
