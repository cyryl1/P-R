import type { ReviewComment, Severity } from '@pr-reviewer/shared';
import { SeveritySchema } from '@pr-reviewer/shared';
import { useState } from 'react';
import { useDeleteComment, useEditComment } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';

const severityVariant: Record<Severity, 'destructive' | 'warning' | 'default'> =
  {
    blocker: 'destructive',
    major: 'warning',
    minor: 'default',
    nit: 'default',
  };

export function CommentCard({
  reviewId,
  comment,
  editable,
}: {
  reviewId: string;
  comment: ReviewComment;
  editable: boolean;
}) {
  const edit = useEditComment(reviewId);
  const remove = useDeleteComment(reviewId);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const patch = (body: Parameters<typeof edit.mutate>[0]['body']) =>
    edit.mutate(
      { cid: comment.id, body },
      { onError: (e) => toast.error(errorMessage(e)) },
    );

  const saveBody = () => {
    setEditing(false);
    if (draft.trim() && draft !== comment.body) patch({ body: draft });
    else setDraft(comment.body);
  };

  return (
    <article
      aria-label={`${comment.source === 'user' ? 'Your' : 'AI'} comment`}
      className={cn(
        'rounded-md border border-l-4 bg-background p-3 text-left font-sans',
        comment.source === 'user' ? 'border-l-primary' : 'border-l-warning',
        !comment.included && 'opacity-50',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {editable ? (
          <select
            aria-label="Severity"
            className="rounded border border-border bg-background px-1 py-0.5 text-xs"
            value={comment.severity}
            onChange={(e) => patch({ severity: e.target.value as Severity })}
          >
            {SeveritySchema.options.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <Badge variant={severityVariant[comment.severity]}>
            {comment.severity}
          </Badge>
        )}
        {comment.ruleId ? <Badge>{comment.ruleId}</Badge> : null}
        {comment.source === 'user' ? <Badge>you</Badge> : null}
        {editable ? (
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={comment.included}
                onChange={(e) => patch({ included: e.target.checked })}
              />
              Include
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                remove.mutate(comment.id, {
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              Delete
            </Button>
          </div>
        ) : null}
      </div>
      {editing ? (
        <textarea
          autoFocus
          aria-label="Comment body"
          className="w-full rounded border border-border bg-background p-2 text-sm"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveBody}
        />
      ) : editable ? (
        <button
          type="button"
          title="Click to edit"
          className="block w-full text-left"
          onClick={() => {
            setDraft(comment.body);
            setEditing(true);
          }}
        >
          <Markdown text={comment.body} />
        </button>
      ) : (
        <Markdown text={comment.body} />
      )}
      {comment.suggestion ? (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">Suggested change</p>
          <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
            {comment.suggestion}
          </pre>
        </div>
      ) : null}
    </article>
  );
}
