import { Loader2, RefreshCw } from 'lucide-react';
import { useHealth, usePollNow } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/lib/utils';

export function PollIndicator() {
  const { data } = useHealth();
  const poll = usePollNow();
  const poller = data?.poller;

  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span>
        {!poller ? 'Checking status…' : !poller.enabled ? 'Polling is off' : `Last checked ${formatRelative(poller.lastRunAt)} · Next ${formatRelative(poller.nextRunAt)}`}
      </span>
      <Button variant="outline" size="sm" onClick={() => poll.mutate()} disabled={poll.isPending}>
        {poll.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
        Check now
      </Button>
    </div>
  );
}
