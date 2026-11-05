import {
  VerdictSchema,
  type ReviewDetail,
  type Verdict,
} from '@pr-reviewer/shared';
import { CircleCheck, CircleHelp, CircleX, Loader, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useEditReview } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { useToast } from '@/components/ui/toast';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Markdown } from './Markdown';
import { RuleChecklist } from './RuleChecklist';
import { StatusBadge } from './StatusBadge';

const verdictLabels: Record<Verdict, string> = {
  COMMENT: 'Comment',
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
};

function useSave(reviewId: string) {
  const edit = useEditReview(reviewId);
  const toast = useToast();
  return (body: { summary?: string; verdict?: Verdict }) =>
    edit.mutate(body, { onError: (e) => toast.error(errorMessage(e)) });
}

export function SummaryEditor({
  review,
  editable,
}: {
  review: ReviewDetail;
  editable: boolean;
}) {
  const save = useSave(review.id);
  const [summary, setSummary] = useState(review.summary);
  const [editing, setEditing] = useState(false);
  useEffect(() => setSummary(review.summary), [review.summary]);
  const finish = () => {
    setEditing(false);
    if (summary !== review.summary) save({ summary });
  };
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Summary</h2>
        {editable && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Edit summary"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </Button>
        ) : null}
      </div>
      {editing ? (
        <textarea
          aria-label="Summary"
          autoFocus
          rows={12}
          className="w-full rounded-lg border border-border bg-background p-3 text-sm leading-relaxed"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter')
              e.currentTarget.blur();
          }}
        />
      ) : summary.trim() ? (
        <Markdown text={summary} />
      ) : (
        <p className="text-sm text-muted-foreground">No summary.</p>
      )}
    </section>
  );
}

const mergeLabels = {
  mergeable: 'Ready to merge',
  conflicting: 'Merge conflicts',
  unknown: 'Merge status unknown',
} as const;
const checkIcons = {
  success: (
    <CircleCheck className="h-4 w-4 text-success-foreground" aria-hidden />
  ),
  failure: <CircleX className="h-4 w-4 text-destructive" aria-hidden />,
  pending: <Loader className="h-4 w-4 text-muted-foreground" aria-hidden />,
} as const;
const sectionTitle = 'text-sm text-muted-foreground';

/** Right-hand panel: status, verdict, comment counts, rule checks. */
export function ReviewRail({
  review,
  editable,
}: {
  review: ReviewDetail;
  editable: boolean;
}) {
  const save = useSave(review.id);
  const blockers = review.comments.filter(
    (c) => c.included && c.severity === 'blocker',
  ).length;
  const excluded = review.comments.filter((c) => !c.included).length;
  const mergeable = review.pr.mergeable;
  const unanchored = review.comments.filter(
    (c) => c.anchorStatus === 'invalid',
  );

  return (
    <aside
      className="w-full shrink-0 space-y-6 lg:w-72"
      aria-label="Review details"
    >
      {mergeable ? (
        <div className="space-y-2">
          <h2 className={sectionTitle}>Merge status</h2>
          <p className="flex items-center gap-2 text-sm">
            {mergeable === 'conflicting' ? (
              <CircleX className="h-4 w-4 text-destructive" aria-hidden />
            ) : mergeable === 'mergeable' ? (
              <CircleCheck
                className="h-4 w-4 text-success-foreground"
                aria-hidden
              />
            ) : (
              <CircleHelp
                className="h-4 w-4 text-muted-foreground"
                aria-hidden
              />
            )}
            {mergeLabels[mergeable]}
          </p>
        </div>
      ) : null}
      <div className="space-y-2 border-t border-border pt-5">
        <h2 className={sectionTitle}>Draft status</h2>
        <StatusBadge status={review.status} />
      </div>
      <div className="space-y-2 border-t border-border pt-5">
        <label htmlFor="verdict" className={sectionTitle}>
          Verdict
        </label>
        <select
          id="verdict"
          disabled={!editable}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={review.verdict}
          onChange={(e) => save({ verdict: e.target.value as Verdict })}
        >
          {VerdictSchema.options.map((v) => (
            <option key={v} value={v}>
              {verdictLabels[v]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2 border-t border-border pt-5">
        <h2 className={sectionTitle}>Draft comments</h2>
        <p className="text-sm">
          {review.comments.length} comments · {blockers} blockers · {excluded}{' '}
          excluded
        </p>
      </div>
      {review.pr.githubComments !== undefined ? (
        <div className="space-y-2 border-t border-border pt-5">
          <h2 className={sectionTitle}>Comments on GitHub</h2>
          <p className="text-sm">
            {review.pr.githubComments
              ? `${review.pr.githubComments} comment${review.pr.githubComments === 1 ? '' : 's'}`
              : 'No comments'}
          </p>
        </div>
      ) : null}
      {review.pr.githubReviews ? (
        <div className="space-y-2 border-t border-border pt-5">
          <h2 className={sectionTitle}>Reviews</h2>
          {review.pr.githubReviews.length ? (
            <ul aria-label="GitHub reviews" className="space-y-1 text-sm">
              {review.pr.githubReviews.map((r, i) => (
                <li key={`${r.author}-${i}`} className="flex gap-2">
                  <Avatar name={r.author} />
                  <span className="font-medium">{r.author}</span>
                  <span className="text-muted-foreground">
                    {r.state.toLowerCase().replace(/_/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No reviews yet</p>
          )}
        </div>
      ) : null}
      {review.pr.checks?.length ? (
        <div className="space-y-2 border-t border-border pt-5">
          <h2 className={sectionTitle}>Checks</h2>
          <ul aria-label="CI checks" className="space-y-2 text-sm">
            {review.pr.checks.map((c) => (
              <li key={c.name} className="flex items-center gap-2">
                {checkIcons[c.state]}
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
                <span className="sr-only">{c.state}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {review.llmMeta?.truncation?.length ? (
        <div
          role="note"
          className="rounded-md border border-warning/50 p-2 text-xs"
        >
          <p className="font-medium">Some input was trimmed for the model</p>
          <ul className="list-disc pl-4">
            {review.llmMeta.truncation.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-2 border-t border-border pt-5">
        <h2 className={sectionTitle}>Rules</h2>
        <RuleChecklist results={review.ruleResults} />
      </div>
      <div className="space-y-2 border-t border-border pt-5">
        <h2 className={sectionTitle}>Unanchored comments</h2>
        {unanchored.length ? (
          <>
            <p className="text-xs text-muted-foreground">
              These point at lines outside the diff, so they go into the summary
              when published.
            </p>
            <ul className="space-y-2" aria-label="Unanchored comments">
              {unanchored.map((c) => (
                <li
                  key={c.id}
                  className="rounded border border-border p-2 text-xs"
                >
                  <span className="font-mono">
                    {c.path}:{c.line}
                  </span>{' '}
                  <span className="text-muted-foreground">[{c.severity}]</span>
                  <p>{c.body}</p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">None.</p>
        )}
      </div>
    </aside>
  );
}
