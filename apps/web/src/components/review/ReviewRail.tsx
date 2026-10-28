import {
  VerdictSchema,
  type ReviewDetail,
  type Verdict,
} from '@pr-reviewer/shared';
import { useEffect, useState } from 'react';
import { useEditReview } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { useToast } from '@/components/ui/toast';
import { RuleChecklist } from './RuleChecklist';

const verdictLabels: Record<Verdict, string> = {
  COMMENT: 'Comment',
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
};

export function ReviewRail({
  review,
  editable,
}: {
  review: ReviewDetail;
  editable: boolean;
}) {
  const edit = useEditReview(review.id);
  const toast = useToast();
  const [summary, setSummary] = useState(review.summary);
  useEffect(() => setSummary(review.summary), [review.summary]);

  const save = (body: { summary?: string; verdict?: Verdict }) =>
    edit.mutate(body, { onError: (e) => toast.error(errorMessage(e)) });
  const unanchored = review.comments.filter(
    (c) => c.anchorStatus === 'invalid',
  );

  return (
    <aside className="w-80 shrink-0 space-y-6" aria-label="Review details">
      <div className="space-y-1">
        <label htmlFor="verdict" className="text-sm font-medium">
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
      <div className="space-y-1">
        <label htmlFor="summary" className="text-sm font-medium">
          Summary
        </label>
        <textarea
          id="summary"
          readOnly={!editable}
          rows={8}
          className="w-full rounded-md border border-border bg-background p-2 text-sm"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => summary !== review.summary && save({ summary })}
        />
      </div>
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
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Rules</h2>
        <RuleChecklist results={review.ruleResults} />
      </div>
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Unanchored comments</h2>
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
