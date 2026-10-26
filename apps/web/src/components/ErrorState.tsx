import type { ErrorCode } from '@pr-reviewer/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';

/** Plain-language text for each error code the UI must handle by name. */
const hints: Partial<Record<ErrorCode | 'NETWORK', string>> = {
  NETWORK: 'Cannot reach the backend. Is `pnpm dev` running?',
  GH_NOT_AUTHENTICATED: 'Run `gh auth login`, then try again.',
  GH_RATE_LIMITED: 'GitHub is rate limiting requests. Wait a minute and retry.',
  LLM_NOT_CONFIGURED:
    'Add OPENROUTER_API_KEY to .env, or switch the provider to mock in Settings.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return hints[error.code] ?? error.message;
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
