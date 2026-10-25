import { AlertTriangle } from 'lucide-react';
import { useHealth } from '@/api/hooks';

/** Returns the fix text for each health problem, in display order. */
export function healthProblems(health: NonNullable<ReturnType<typeof useHealth>['data']>): string[] {
  const problems: string[] = [];
  if (!health.gh.authenticated) problems.push('`gh` is not logged in — run `gh auth login`');
  if (!health.llm.configured) problems.push('No API key — add ANTHROPIC_API_KEY to .env (reviews will use the mock provider)');
  if (health.poller.lastError) problems.push(`Last poll failed: ${health.poller.lastError}`);
  return problems;
}

export function HealthBanner() {
  const { data, error } = useHealth();
  const problems = error ? ['Cannot reach the backend — is `pnpm dev` running?'] : data ? healthProblems(data) : [];
  if (problems.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-1 border-b border-border bg-warning px-6 py-2 text-sm text-warning-foreground">
      {problems.map((problem) => (
        <div key={problem} className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{problem}</span>
        </div>
      ))}
    </div>
  );
}
