import type { RuleResultStatus } from '@pr-reviewer/shared';
import { Check, CircleHelp, Minus, X } from 'lucide-react';
import type { ReviewDetail } from '@pr-reviewer/shared';
import { Badge } from '@/components/ui/badge';

type RuleResult = ReviewDetail['ruleResults'][number];

const order: RuleResultStatus[] = ['fail', 'unsure', 'pass', 'na'];
const icons = {
  fail: <X className="h-4 w-4 text-destructive" aria-label="fail" />,
  unsure: <CircleHelp className="h-4 w-4 text-warning" aria-label="unsure" />,
  pass: <Check className="h-4 w-4 text-success" aria-label="pass" />,
  na: <Minus className="h-4 w-4 text-muted-foreground" aria-label="n/a" />,
} as const;

export function RuleChecklist({ results }: { results: RuleResult[] }) {
  if (!results.length)
    return <p className="text-sm text-muted-foreground">No rule results.</p>;
  const sorted = [...results].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
  );
  return (
    <ul aria-label="Rule checklist" className="space-y-2">
      {sorted.map((r) => (
        <li key={r.ruleId} className="flex gap-2 text-sm">
          <span className="mt-0.5">{icons[r.status]}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{r.ruleId}</span>
              <Badge>{r.severity}</Badge>
            </div>
            {r.note ? (
              <p className="text-xs text-muted-foreground">{r.note}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
