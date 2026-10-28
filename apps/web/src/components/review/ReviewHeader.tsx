import type { ReviewDetail } from '@pr-reviewer/shared';
import { ExternalLink } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

export function ReviewHeader({ review }: { review: ReviewDetail }) {
  const { pr, llmMeta } = review;
  return (
    <header className="space-y-1">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{pr.title}</h1>
        <StatusBadge status={review.status} />
      </div>
      <p className="text-sm text-muted-foreground">
        {review.repo}#{review.number} · {pr.author} · {pr.headRef} →{' '}
        {pr.baseRef} · <code>{review.headSha.slice(0, 7)}</code> ·{' '}
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          GitHub <ExternalLink className="h-3 w-3" />
        </a>
      </p>
      {llmMeta ? (
        <p className="text-xs text-muted-foreground">
          {llmMeta.model} · {llmMeta.inputTokens + llmMeta.outputTokens} tokens
        </p>
      ) : null}
    </header>
  );
}
