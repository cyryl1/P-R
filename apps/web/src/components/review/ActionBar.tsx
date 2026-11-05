import type { ReviewDetail } from '@pr-reviewer/shared';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDismissReview, useRerunReview } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { usePublishFlow } from './PublishFlow';
import { isEditable } from './StatusBadge';

/** Rerun, Dismiss, and the publish flow (pending by default; submit needs confirmation). */
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
  const active = isEditable(review.status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        asChild
        variant="outline"
        size="icon"
        className="rounded-full"
        title="Open on GitHub"
      >
        <a href={review.pr.url} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" aria-hidden />
          <span className="sr-only">GitHub</span>
        </a>
      </Button>
      <Button
        variant="outline"
        className="rounded-full"
        disabled={rerun.isPending}
        onClick={doRerun}
      >
        Rerun
      </Button>
      {active ? (
        <>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => setConfirmDismiss(true)}
          >
            Dismiss
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            disabled={flow.isPending}
            onClick={flow.requestSubmit}
          >
            Submit now…
          </Button>
          <Button
            className="rounded-full"
            disabled={flow.isPending}
            onClick={flow.publishPending}
          >
            {flow.isPending ? 'Publishing…' : 'Publish as pending review'}
          </Button>
        </>
      ) : review.github ? (
        <Button asChild variant="outline" className="rounded-full">
          <a href={review.github.url} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
        </Button>
      ) : null}
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
