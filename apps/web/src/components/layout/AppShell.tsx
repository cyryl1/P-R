import { History, Inbox, Settings, FolderCog } from 'lucide-react';
import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { useEvents } from '@/api/events';
import { useInbox } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { ToastProvider } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { HealthBanner } from './HealthBanner';
import { PollIndicator } from './PollIndicator';
import { PrSidebar } from './PrSidebar';

const links = [
  { to: '/', label: 'Reviews', icon: Inbox, end: true },
  { to: '/projects', label: 'Projects', icon: FolderCog, end: false },
  { to: '/history', label: 'History', icon: History, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

export function AppShell() {
  useEvents();
  const { data: inbox } = useInbox();
  const onHome = !!useMatch('/');
  const onReview = !!useMatch('/reviews/*');
  const waiting =
    inbox?.filter(
      (item) =>
        item.relation !== 'authored' &&
        item.rulesState === 'ok' &&
        item.latestReview?.status !== 'published_pending' &&
        item.latestReview?.status !== 'submitted',
    ).length ?? 0;

  return (
    <ToastProvider>
      <div className="flex h-screen flex-col md:flex-row">
        <aside className="flex w-full shrink-0 items-center gap-1 border-b border-border p-2 md:w-14 md:flex-col md:border-b-0 md:border-r md:py-3">
          <nav
            aria-label="Main"
            className="flex flex-row gap-1 md:flex-col md:items-center"
          >
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground',
                    isActive && 'bg-muted text-foreground',
                  )
                }
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="sr-only">{label}</span>
                {label === 'Reviews' && waiting > 0 ? (
                  <Badge
                    aria-label={`${waiting} waiting`}
                    className="absolute -right-1 -top-1 min-w-4 justify-center bg-primary px-1 py-0 text-[10px] text-primary-foreground"
                  >
                    {waiting}
                  </Badge>
                ) : null}
              </NavLink>
            ))}
          </nav>
        </aside>
        <PrSidebar fullOnMobile={onHome} />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <header className="flex h-12 shrink-0 items-center justify-end border-b border-border px-4 md:px-6">
            <PollIndicator />
          </header>
          <HealthBanner />
          <main className={cn('min-w-0 flex-1', !onReview && 'p-4 md:p-6')}>
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
