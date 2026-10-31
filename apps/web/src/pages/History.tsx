import { ReviewStatusSchema, type ActivityEntry } from '@pr-reviewer/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useActivity, useReviewHistory } from '@/api/hooks';
import { ErrorState, LoadingState } from '@/components/ErrorState';
import { StatusBadge } from '@/components/review/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatRelative } from '@/lib/utils';

type Tab = 'reviews' | 'activity';

function ReviewsTab() {
  const [status, setStatus] = useState('');
  const [repo, setRepo] = useState('');
  const history = useReviewHistory({
    ...(status ? { status: status as never } : {}),
    ...(repo.trim() ? { repo: repo.trim() } : {}),
  });
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <label className="flex items-center gap-2 text-sm">
          Status
          <select
            aria-label="Status"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            {ReviewStatusSchema.options.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <Input
          aria-label="Repo"
          className="max-w-64"
          placeholder="Filter by owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
      </div>
      {history.isPending ? (
        <LoadingState label="Loading reviews…" />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => history.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews match.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <caption className="sr-only">Review history</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">PR</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Trigger</th>
                <th className="px-3 py-2 font-medium">Comments</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.repo}#{r.number}
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/reviews/${r.id}`} className="hover:underline">
                      {r.prTitle}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.trigger}</td>
                  <td className="px-3 py-2">
                    {r.commentCount}
                    {r.blockerCount ? ` (${r.blockerCount} blocker)` : ''}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatRelative(r.updatedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.hasNextPage ? (
            <Button
              variant="outline"
              disabled={history.isFetchingNextPage}
              onClick={() => history.fetchNextPage()}
            >
              Load more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

const levelVariant = {
  info: 'default',
  warn: 'warning',
  error: 'destructive',
} as const;

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="flex items-baseline gap-3 border-t border-border px-3 py-2 text-sm">
      <Badge variant={levelVariant[entry.level]}>{entry.level}</Badge>
      <span className="flex-1">
        {entry.reviewId ? (
          <Link to={`/reviews/${entry.reviewId}`} className="hover:underline">
            {entry.message}
          </Link>
        ) : (
          entry.message
        )}
      </span>
      <time dateTime={entry.ts} className="text-xs text-muted-foreground">
        {formatRelative(entry.ts)}
      </time>
    </li>
  );
}

function ActivityTab() {
  const [level, setLevel] = useState('');
  const activity = useActivity();
  const entries = (activity.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (e) => !level || e.level === level,
  );

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        Level
        <select
          aria-label="Level"
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="">All</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </label>
      {activity.isPending ? (
        <LoadingState label="Loading activity…" />
      ) : activity.isError ? (
        <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul aria-label="Activity log">
          {entries.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {activity.hasNextPage ? (
        <Button
          variant="outline"
          disabled={activity.isFetchingNextPage}
          onClick={() => activity.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}

export function History() {
  const [tab, setTab] = useState<Tab>('reviews');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">History</h1>
      <div
        role="tablist"
        aria-label="History"
        className="flex gap-1 border-b border-border"
      >
        {(['reviews', 'activity'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm capitalize',
              tab === t
                ? 'border-primary font-medium'
                : 'border-transparent text-muted-foreground',
            )}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'reviews' ? <ReviewsTab /> : <ActivityTab />}
      </div>
    </div>
  );
}
