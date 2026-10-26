import type { RulesFile } from '@pr-reviewer/shared';
import { Badge } from '@/components/ui/badge';

const severityVariant = {
  blocker: 'destructive',
  major: 'warning',
  minor: 'default',
  nit: 'default',
} as const;

export function ParsedSummary({ parsed }: { parsed: RulesFile }) {
  const { triggers, review, rules } = parsed;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Repo</dt>
        <dd>
          {parsed.repo}
          {parsed.enabled ? '' : ' (disabled)'}
        </dd>
        <dt className="text-muted-foreground">On review request</dt>
        <dd>{triggers.on_review_request}</dd>
        <dt className="text-muted-foreground">On new commits</dt>
        <dd>{triggers.on_new_commits}</dd>
        <dt className="text-muted-foreground">Skip drafts</dt>
        <dd>{triggers.skip_drafts ? 'yes' : 'no'}</dd>
        <dt className="text-muted-foreground">Max comments</dt>
        <dd>
          {review.max_comments} (min severity {review.min_severity})
        </dd>
      </dl>
      <div>
        <h4 className="mb-1 font-medium">Focus</h4>
        <ul className="flex flex-wrap gap-1.5">
          {Object.entries(review.focus).map(([area, level]) => (
            <li key={area}>
              <Badge variant={level === 'strict' ? 'warning' : 'default'}>
                {area}: {level}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-1 font-medium">Rules ({rules.length})</h4>
        {rules.length === 0 ? (
          <p className="text-muted-foreground">No rules defined.</p>
        ) : (
          <ul className="space-y-1">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-2">
                <code className="text-xs">{rule.id}</code>
                <span className="text-muted-foreground">{rule.type}</span>
                <Badge variant={severityVariant[rule.severity]}>
                  {rule.severity}
                </Badge>
                {rule.enabled ? null : <Badge>off</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
