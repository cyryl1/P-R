import type { InboxItem } from '@pr-reviewer/shared';
import { Loader2, Search } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useCreateReview, useInbox } from '@/api/hooks';
import { errorMessage } from '@/components/ErrorState';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { inboxRowState } from '@/lib/inboxStatus';
import { isDone, itemLink } from '@/lib/inboxStatus';
import { cn, formatRelative } from '@/lib/utils';

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

const itemClass = (active: boolean) =>
  cn(
    'flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted',
    active && 'bg-muted',
  );

function ItemBody({ item }: { item: InboxItem }) {
  const { badge, stale } = inboxRowState(item);
  const attention =
    item.rulesState !== 'ok' || stale || item.latestReview?.status === 'failed';
  return (
    <>
      <span className="line-clamp-2 font-medium">{item.pr.title}</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Avatar name={item.pr.author} />
        <span className="truncate">{item.pr.author}</span>·
        <span className="shrink-0">{formatRelative(item.pr.updatedAt)}</span>
      </span>
      {attention ? (
        <Badge variant={stale ? 'warning' : badge.variant} className="w-fit">
          {stale ? 'Stale' : badge.label}
        </Badge>
      ) : null}
    </>
  );
}

function PrItem({ item }: { item: InboxItem }) {
  const create = useCreateReview();
  const navigate = useNavigate();
  const toast = useToast();
  const to = itemLink(item);
  if (to)
    return (
      <NavLink to={to} className={({ isActive }) => itemClass(isActive)}>
        <ItemBody item={item} />
      </NavLink>
    );
  return (
    <button
      type="button"
      disabled={create.isPending}
      title="Run a review"
      className={itemClass(false)}
      onClick={() =>
        create.mutate(item.pr.url, {
          onSuccess: (r) => navigate(`/reviews/${r.id}`),
          onError: (e) => toast.error(errorMessage(e)),
        })
      }
    >
      <ItemBody item={item} />
    </button>
  );
}

function Group({ title, items }: { title: string; items: InboxItem[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-1">
      <h2 className="px-3 pb-1 text-sm text-muted-foreground">{title}</h2>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={`${item.pr.repo}#${item.pr.number}`}>
            <PrItem item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Pull requests list beside the review page; the search box also takes a pasted PR URL. */
export function PrSidebar({ fullOnMobile }: { fullOnMobile: boolean }) {
  const inbox = useInbox();
  const create = useCreateReview();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const text = query.trim();
  const isUrl = PR_URL.test(text);

  const items = [...(inbox.data ?? [])]
    .sort(
      (a, b) =>
        new Date(b.pr.updatedAt).getTime() - new Date(a.pr.updatedAt).getTime(),
    )
    .filter(
      (i) =>
        isUrl ||
        `${i.pr.title} ${i.pr.author} ${i.pr.repo}#${i.pr.number}`
          .toLowerCase()
          .includes(text.toLowerCase()),
    );
  const inGroup = (relation: InboxItem['relation']) =>
    items
      .filter((i) => (i.relation ?? 'review_requested') === relation)
      // Finished reviews sink to the bottom of their group.
      .sort((a, b) => Number(isDone(a)) - Number(isDone(b)));

  return (
    <aside
      aria-label="Pull requests"
      className={cn(
        'w-full shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-muted/40 p-3 lg:flex lg:w-72',
        fullOnMobile ? 'flex' : 'hidden',
      )}
    >
      <h2 className="px-2 pt-1 text-lg font-semibold">Code Review</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isUrl) return;
          create.mutate(text, {
            onSuccess: (r) => {
              setQuery('');
              navigate(`/reviews/${r.id}`);
            },
          });
        }}
        className="relative"
      >
        {create.isPending ? (
          <Loader2
            className="absolute left-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : (
          <Search
            className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
        )}
        <input
          aria-label="Search or paste a PR link"
          placeholder="Search or paste a PR link"
          value={query}
          disabled={create.isPending}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 w-full rounded-full border border-border bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {create.isPending ? (
          <p role="status" className="px-3 pt-1 text-xs text-muted-foreground">
            Fetching the PR and running the review. This can take a minute or
            two; you will be taken to it when it finishes.
          </p>
        ) : isUrl ? (
          <p className="px-3 pt-1 text-xs text-muted-foreground">
            Press Enter to review this PR.
          </p>
        ) : null}
        {create.error ? (
          <p role="alert" className="px-3 pt-1 text-xs text-destructive">
            {errorMessage(create.error)}
          </p>
        ) : null}
      </form>
      {inbox.isPending ? (
        <p className="px-3 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Group title="Authored by me" items={inGroup('authored')} />
          <Group title="Needs my review" items={inGroup('review_requested')} />
          <Group
            title="Needs my team's review"
            items={inGroup('team_review_requested')}
          />
          {items.length === 0 ? (
            <p className="px-3 text-sm text-muted-foreground">
              No pull requests match.
            </p>
          ) : null}
        </>
      )}
    </aside>
  );
}
