import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AskForm } from './AskForm';
import { PrCommentForm } from './PrCommentForm';

type Mode = 'ask' | 'comment';

/** Sticky bar at the bottom of a review: ask the model, or comment on the PR yourself. */
export function ChatBar({
  reviewId,
  prNumber,
}: {
  reviewId: string;
  prNumber: number;
}) {
  const [mode, setMode] = useState<Mode>('ask');
  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      className={cn(
        'rounded-full px-3 py-1 text-xs text-muted-foreground',
        mode === value && 'bg-muted font-medium text-foreground',
      )}
      onClick={() => setMode(value)}
    >
      {label}
    </button>
  );
  return (
    <div className="sticky bottom-0 z-10 space-y-2 border-t border-border bg-background px-4 pb-4 pt-3 md:px-8">
      <div role="tablist" aria-label="Message type" className="flex gap-1 px-1">
        {tab('ask', 'Ask about this PR')}
        {tab('comment', 'Leave a comment')}
      </div>
      {mode === 'ask' ? (
        <AskForm reviewId={reviewId} />
      ) : (
        <PrCommentForm reviewId={reviewId} prNumber={prNumber} />
      )}
    </div>
  );
}
