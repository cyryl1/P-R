import type { ErrorCode } from '@pr-reviewer/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';

/** Replaces the server text where the fix is something the user does outside the app. */
const overrides: Partial<Record<ErrorCode | 'NETWORK', string>> = {
  NETWORK: 'Cannot reach the backend. Is `pnpm dev` running?',
  GH_NOT_AUTHENTICATED: 'Run `gh auth login`, then try again.',
  GH_RATE_LIMITED: 'GitHub is rate limiting requests. Wait a minute and retry.',
  LLM_NOT_CONFIGURED:
    'Add OPENROUTER_API_KEY to .env, or switch the provider to mock in Settings.',
};

/** Appended to the server's own message to say what to do next. */
const nextSteps: Partial<Record<ErrorCode, string>> = {
  GH_NOT_FOUND: 'Check the URL and that `gh` has access to the repo.',
  RULES_INVALID: 'Fix the rules file in Projects.',
  NO_RULES: 'Add rules for this repo in Projects.',
  INVALID_STATE: "Reload to see the review's current state.",
  HEAD_MOVED: 'Re-run the review or publish anyway.',
  PENDING_EXISTS: 'Replace it or open it on GitHub.',
  INTERNAL: 'Check the server logs, then retry.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const override = overrides[error.code];
    if (override) return override;
    const next = error.code === 'NETWORK' ? undefined : nextSteps[error.code];
    return next ? `${error.message} ${next}` : error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-md border border-destructive/40 p-4 text-sm"
    >
      <span>{errorMessage(error)}</span>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {label}
    </p>
  );
}
