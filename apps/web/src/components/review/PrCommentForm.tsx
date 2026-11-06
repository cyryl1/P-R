import { ExternalLink, Loader2, SendHorizontal } from 'lucide-react';
import { useState } from 'react';
import { usePostPrComment } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';

/** A plain comment on the GitHub PR. It is public as soon as it is posted, so it asks first. */
export function PrCommentForm({
  reviewId,
  prNumber,
}: {
  reviewId: string;
  prNumber: number;
}) {
  const post = usePostPrComment(reviewId);
  const toast = useToast();
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  const text = body.trim();

  return (
    <div className="space-y-2">
      <form
        className="flex items-end gap-2 rounded-2xl border border-border bg-background px-4 py-2 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (text && !post.isPending) setConfirming(true);
        }}
      >
        <textarea
          aria-label="Leave a comment"
          placeholder="Leave a comment on this pull request"
          rows={2}
          maxLength={65_536}
          value={body}
          disabled={post.isPending}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              if (text) setConfirming(true);
            }
          }}
          className="max-h-40 min-h-10 min-w-0 flex-1 resize-y bg-transparent py-1 text-sm focus-visible:outline-none"
        />
        <button
          type="submit"
          aria-label="Post comment"
          disabled={!text || post.isPending}
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          {post.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden />
          )}
        </button>
      </form>
      {post.error ? (
        <p role="alert" className="px-2 text-sm text-destructive">
          {errorMessage(post.error)}
        </p>
      ) : post.data ? (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          Comment posted.{' '}
          <a
            href={post.data.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            View on GitHub <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </p>
      ) : (
        <p className="px-2 text-xs text-muted-foreground">
          Posted to GitHub right away, separate from your draft review.{' '}
          <kbd>⌘</kbd>
          <kbd>↵</kbd> to post.
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Post this comment on PR #${prNumber}?`}
        description="It goes to GitHub immediately and is visible to everyone on the PR. It does not wait for your pending review."
        confirmLabel="Post comment"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          post.mutate(text, {
            onSuccess: () => {
              setBody('');
              toast.success('Comment posted');
            },
          });
        }}
      />
    </div>
  );
}
