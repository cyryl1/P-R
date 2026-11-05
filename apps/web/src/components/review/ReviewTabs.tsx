import { cn } from '@/lib/utils';

export type ReviewTab = 'summary' | 'changes';

/** Summary / Changes switch with the diff size, like the PR page it mirrors. */
export function ReviewTabs({
  tab,
  onChange,
  additions,
  deletions,
}: {
  tab: ReviewTab;
  onChange: (tab: ReviewTab) => void;
  additions: number;
  deletions: number;
}) {
  const base =
    'rounded-full px-4 py-1.5 text-sm text-muted-foreground transition-colors';
  const active = 'bg-background font-medium text-foreground shadow-sm';
  return (
    <div
      role="tablist"
      aria-label="Review sections"
      className="inline-flex rounded-full border border-border bg-muted/60 p-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'summary'}
        className={cn(base, tab === 'summary' && active)}
        onClick={() => onChange('summary')}
      >
        Summary
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'changes'}
        className={cn(base, tab === 'changes' && active)}
        onClick={() => onChange('changes')}
      >
        Changes <span className="text-success-foreground">+{additions}</span>{' '}
        <span className="text-destructive">−{deletions}</span>
      </button>
    </div>
  );
}
