import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Placeholder } from '@/pages/Placeholder';

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Placeholder title="Inbox" phase={3} /> },
      { path: '/reviews/:id', element: <Placeholder title="Review" phase={2} /> },
      { path: '/projects', element: <Placeholder title="Projects" phase={1} /> },
      { path: '/projects/:owner/:repo', element: <Placeholder title="Project editor" phase={1} /> },
      { path: '/history', element: <Placeholder title="History" phase={4} /> },
      { path: '/settings', element: <Placeholder title="Settings" phase={1} /> },
      { path: '*', element: <Placeholder title="Not found" phase={0} /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
