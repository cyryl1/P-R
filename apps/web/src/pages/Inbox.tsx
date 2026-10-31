import { ExternalLink } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useCreateReview,
  useHealth,
  useInbox,
  useRerunReview,
} from '@/api/hooks';
import {
  ErrorState,
  LoadingState,
  errorMessage,
} from '@/components/ErrorState';
import { ReviewByUrlForm } from '@/components/review/ReviewByUrlForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { inboxRowState } from '@/lib/inboxStatus';
import { formatRelative } from '@/lib/utils';
import type { InboxItem } from '@pr-reviewer/shared';

function RetryButton({
  reviewId,
  error,
  label,
}: {
  reviewId: string;
  error?: string;
  label: string;
}) {
  const rerun = useRerunReview(reviewId);
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="outline"
      title={error}
      disabled={rerun.isPending}
      onClick={() =>
        rerun.mutate(undefined, {
          onSuccess: (r) => navigate(`/reviews/${r.id}`),
          onError: (e) => toast.error(errorMessage(e)),
        })
      }
    >
      {label}
    </Button>
  );
}

function ReviewNowButton({ url, label }: { url: string; label: string }) {
  const create = useCreateReview();
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <Button
      size="sm"
      disabled={create.isPending}
      onClick={() =>
        create.mutate(url, {
          onSuccess: (r) => navigate(`/reviews/${r.id}`),
          onError: (e) => toast.error(errorMessage(e)),
        })
      }
    >
      {label}
    </Button>
  );
}

function Row({ item }: { item: InboxItem }) {
  const { badge, stale, action } = inboxRowState(item);
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 font-mono text-xs">
        {item.pr.repo}#{item.pr.number}
      </td>
      <td className="px-3 py-2">
        <a
          href={item.pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
        >
          {item.pr.title}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        {item.pr.isDraft ? <Badge className="ml-2">draft PR</Badge> : null}
      </td>
      <td className="px-3 py-2">{item.pr.author}</td>
      <td className="px-3 py-2 text-muted-foreground">
        {formatRelative(item.pr.updatedAt)}
      </td>
      <td className="px-3 py-2">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {stale && badge.label !== 'Stale' ? (
          <Badge variant="warning" className="ml-1">
            Stale
          </Badge>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right">
        {action.kind === 'link' ? (
          <Button asChild size="sm" variant="outline">
            <Link to={action.to}>{action.label}</Link>
          </Button>
        ) : action.kind === 'external' ? (
          <Button asChild size="sm" variant="outline">
            <a href={action.href} target="_blank" rel="noreferrer">
              {action.label}
            </a>
          </Button>
        ) : action.kind === 'review' ? (
          <ReviewNowButton url={item.pr.url} label={action.label} />
        ) : action.kind === 'retry' ? (
          <RetryButton
            reviewId={action.reviewId}
            label={action.label}
            {...(action.error ? { error: action.error } : {})}
          />
        ) : (
          <Button size="sm" variant="outline" disabled>
            {action.label}
          </Button>
        )}
      </td>
    </tr>
  );
}

export function Inbox() {
  const inbox = useInbox();
  const health = useHealth();

  return (
    <div className="space-y-6">
      <ReviewByUrlForm />
      {inbox.isPending ? (
        <LoadingState label="Loading inbox…" />
      ) : inbox.isError ? (
        <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : inbox.data.length === 0 ? (
        <div className="rounded-md border border-border p-8 text-center">
          <p className="font-medium">Nothing is waiting on you</p>
          <p className="text-sm text-muted-foreground">
            Last checked {formatRelative(health.data?.poller.lastRunAt)}.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">
            Pull requests waiting for your review
          </caption>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">PR</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Author</th>
              <th className="px-3 py-2 font-medium">Updated</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {[...inbox.data]
              .sort(
                (a, b) =>
                  new Date(b.pr.updatedAt).getTime() -
                  new Date(a.pr.updatedAt).getTime(),
              )
              .map((item) => (
                <Row key={`${item.pr.repo}#${item.pr.number}`} item={item} />
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
