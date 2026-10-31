import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { History } from '@/pages/History';
import { Inbox } from '@/pages/Inbox';
import { Placeholder } from '@/pages/Placeholder';
import { ProjectEditor } from '@/pages/ProjectEditor';
import { ReviewDetail } from '@/pages/ReviewDetail';
import { Projects } from '@/pages/Projects';
import { Settings } from '@/pages/Settings';

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Inbox /> },
      {
        path: '/reviews/:id',
        element: <ReviewDetail />,
      },
      { path: '/projects', element: <Projects /> },
      { path: '/projects/:owner/:repo', element: <ProjectEditor /> },
      { path: '/history', element: <History /> },
      { path: '/settings', element: <Settings /> },
      { path: '*', element: <Placeholder title="Not found" phase={0} /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
