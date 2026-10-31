import type { ReviewDetail, Verdict } from '@pr-reviewer/shared';
import { useState } from 'react';
import { usePublishReview } from '@/api/hooks';
import { ApiError } from '@/api/client';
import type { PublishBody } from '@/api/types';
import { errorMessage } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';

const verdictLabels: Record<Verdict, string> = {
  COMMENT: 'Comment',
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
};

type Mode = PublishBody['mode'];
type Conflict = 'HEAD_MOVED' | 'PENDING_EXISTS';

/**
 * Drives publish and submit, including the two 409 recovery dialogs.
 * Nothing reaches GitHub as a submitted review without the explicit confirm dialog.
 */
export function usePublishFlow(
  review: ReviewDetail,
  { onRerun }: { onRerun: () => void },
) {
  const publish = usePublishReview(review.id);
  const toast = useToast();
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [conflict, setConflict] = useState<{ code: Conflict; mode: Mode }>();

  const included = review.comments.filter((c) => c.included).length;

  const run = (
    mode: Mode,
    flags: Pick<PublishBody, 'force' | 'replacePending'> = {},
  ) => {
    setConflict(undefined);
    publish.mutate(
      {
        mode,
        ...(mode === 'submit' ? { event: review.verdict } : {}),
        ...flags,
      },
      {
        onSuccess: (res) => {
          const folded = res.foldedIntoSummary
            ? ` · ${res.foldedIntoSummary} comment${res.foldedIntoSummary === 1 ? '' : 's'} folded into the summary`
            : '';
          toast.success(
            `${mode === 'submit' ? 'Review submitted' : 'Pending review created'} · ${res.publishedComments} inline comment${res.publishedComments === 1 ? '' : 's'}${folded}`,
            { label: 'Open on GitHub', href: res.githubReviewUrl },
          );
        },
        onError: (error) => {
          if (
            error instanceof ApiError &&
            (error.code === 'HEAD_MOVED' || error.code === 'PENDING_EXISTS')
          )
            setConflict({ code: error.code, mode });
          else toast.error(errorMessage(error));
        },
      },
    );
  };

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirmSubmit}
        title="Submit this review to GitHub?"
        description={`This posts your review publicly as "${verdictLabels[review.verdict]}" with ${included} comment${included === 1 ? '' : 's'}. It cannot be undone from here.`}
        confirmLabel="Submit review"
        onCancel={() => setConfirmSubmit(false)}
        onConfirm={() => {
          setConfirmSubmit(false);
          run('submit');
        }}
      />
      <Dialog
        open={conflict?.code === 'HEAD_MOVED'}
        onOpenChange={(open) => !open && setConflict(undefined)}
        title="New commits were pushed"
        description="The author pushed new commits. Publish anyway (comments may be outdated) or re-run the review?"
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConflict(undefined)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setConflict(undefined);
              onRerun();
            }}
          >
            Re-run review
          </Button>
          <Button
            onClick={() => conflict && run(conflict.mode, { force: true })}
          >
            Publish anyway
          </Button>
        </div>
      </Dialog>
      <ConfirmDialog
        open={conflict?.code === 'PENDING_EXISTS'}
        title="You already have a pending review"
        description="You already have a pending review on this PR. Replace it with this one?"
        confirmLabel="Replace pending review"
        onCancel={() => setConflict(undefined)}
        onConfirm={() =>
          conflict && run(conflict.mode, { replacePending: true })
        }
      />
    </>
  );

  return {
    isPending: publish.isPending,
    publishPending: () => run('pending'),
    requestSubmit: () => setConfirmSubmit(true),
    dialogs,
  };
}
