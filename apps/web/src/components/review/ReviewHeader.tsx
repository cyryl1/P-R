import type { ReviewDetail } from '@pr-reviewer/shared';
import { ArrowRight } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { formatRelative } from '@/lib/utils';

export function ReviewHeader({ review }: { review: ReviewDetail }) {
  const { pr, llmMeta } = review;
  return (
    <header className="space-y-2">
      <h1 className="text-3xl font-semibold leading-tight tracking-tight">
        {pr.title}
      </h1>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <Avatar name={pr.author} />
        <span className="font-medium text-foreground">{pr.author}</span>
        <span>{formatRelative(review.createdAt)}</span>·
        <span>
          {review.repo}#{review.number}
        </span>
        ·
        <span className="inline-flex items-center gap-1">
          {pr.headRef} <ArrowRight className="h-3 w-3" aria-hidden />{' '}
          {pr.baseRef}
        </span>
        ·<code>{review.headSha.slice(0, 7)}</code>
      </p>
      {llmMeta ? (
        <p className="text-xs text-muted-foreground">
          {llmMeta.model} · {llmMeta.inputTokens + llmMeta.outputTokens} tokens
        </p>
      ) : null}
    </header>
  );
}
