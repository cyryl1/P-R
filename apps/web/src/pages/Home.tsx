import { Navigate } from 'react-router-dom';
import { useHealth, useInbox } from '@/api/hooks';
import { ErrorState, LoadingState } from '@/components/ErrorState';
import { formatRelative } from '@/lib/utils';
import { useProject } from '@/components/layout/ProjectContext';
import { reviewTarget } from '@/lib/inboxStatus';

const isDesktop = () =>
  typeof window.matchMedia !== 'function' ||
  window.matchMedia('(min-width: 1024px)').matches;

/** Landing page: opens the most recently updated PR that needs attention; the sidebar lists the rest. */
export function Home() {
  const inbox = useInbox();
  const health = useHealth();
  const { project, items } = useProject();
  if (inbox.isPending)
    return (
      <div className="p-4 md:p-8">
        <LoadingState label="Loading pull requests…" />
      </div>
    );
  if (inbox.isError)
    return (
      <div className="p-4 md:p-8">
        <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
      </div>
    );
  const target = reviewTarget(items);
  if (target && isDesktop()) return <Navigate to={target} replace />;
  return (
    <div className="p-4 md:p-8">
      <div className="rounded-lg border border-border p-8 text-center">
        <p className="font-medium">
          {items.length
            ? 'Pick a pull request from the list'
            : project
              ? `Nothing is waiting on you in ${project}`
              : 'Nothing is waiting on you'}
        </p>
        <p className="text-sm text-muted-foreground">
          Last checked {formatRelative(health.data?.poller.lastRunAt)}. Paste a
          PR link in the search box to review any pull request.
        </p>
      </div>
    </div>
  );
}
