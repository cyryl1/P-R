import { Loader2, RefreshCw } from 'lucide-react';
import { useHealth, usePollNow, usePollStatus } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/lib/utils';

export function PollIndicator() {
  const { data } = useHealth();
  const poll = usePollNow();
  const status = usePollStatus().data;
  const running = status?.state === 'running';
  const poller = data?.poller;

  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span title={status?.state === 'error' ? status.error : undefined}>
        {running
          ? 'Checking GitHub…'
          : status?.state === 'error'
            ? `Last check failed${status.error ? `: ${status.error}` : ''}`
            : !poller
              ? 'Checking status…'
              : !poller.enabled
                ? 'Polling is off'
                : `Last checked ${formatRelative(poller.lastRunAt)} · Next ${formatRelative(poller.nextRunAt)}`}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => poll.mutate()}
        disabled={poll.isPending || running}
      >
        {poll.isPending || running ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
        Check now
      </Button>
    </div>
  );
}
