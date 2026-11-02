import type { ReviewComment } from '@pr-reviewer/shared';
import { CommentCard } from './CommentCard';

export function CommentList({
  reviewId,
  comments,
  editable,
}: {
  reviewId: string;
  comments: ReviewComment[];
  editable: boolean;
}) {
  const included = comments.filter((c) => c.included).length;
  return (
    <section aria-labelledby="comment-list-heading" className="space-y-3">
      <div>
        <h2 id="comment-list-heading" className="text-base font-semibold">
          Comments to post
        </h2>
        <p className="text-sm text-muted-foreground">
          {comments.length === 0
            ? 'No problems found. Nothing to post except the summary.'
            : `${included} of ${comments.length} will be posted. Click a comment to edit it, untick Include to leave it out.`}
        </p>
      </div>
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="space-y-1">
            <p className="font-mono text-xs text-muted-foreground">
              {c.path}
              {c.line ? `:${c.line}` : ''}
              {c.anchorStatus === 'invalid'
                ? ' (not on a changed line, goes into the summary)'
                : ''}
            </p>
            <CommentCard reviewId={reviewId} comment={c} editable={editable} />
          </li>
        ))}
      </ul>
    </section>
  );
}
