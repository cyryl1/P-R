import { History, Inbox, Settings, FolderCog } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useEvents } from '@/api/events';
import { useInbox } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { ToastProvider } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { HealthBanner } from './HealthBanner';
import { PollIndicator } from './PollIndicator';

const links = [
  { to: '/', label: 'Inbox', icon: Inbox, end: true },
  { to: '/projects', label: 'Projects', icon: FolderCog, end: false },
  { to: '/history', label: 'History', icon: History, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

export function AppShell() {
  useEvents();
  const { data: inbox } = useInbox();
  const waiting =
    inbox?.filter(
      (item) =>
        item.rulesState === 'ok' &&
        item.latestReview?.status !== 'published_pending' &&
        item.latestReview?.status !== 'submitted',
    ).length ?? 0;

  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-border p-3">
          <div className="px-3 py-2 text-base font-semibold">PR Reviewer</div>
          <nav aria-label="Main" className="flex flex-col gap-1">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted',
                    isActive && 'bg-muted font-medium',
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="flex-1">{label}</span>
                {label === 'Inbox' && waiting > 0 ? (
                  <Badge aria-label={`${waiting} waiting`}>{waiting}</Badge>
                ) : null}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-end border-b border-border px-6">
            <PollIndicator />
          </header>
          <HealthBanner />
          <main className="flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
