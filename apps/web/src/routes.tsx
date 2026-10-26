import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Placeholder } from '@/pages/Placeholder';
import { ProjectEditor } from '@/pages/ProjectEditor';
import { Projects } from '@/pages/Projects';
import { Settings } from '@/pages/Settings';

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Placeholder title="Inbox" phase={3} /> },
      {
        path: '/reviews/:id',
        element: <Placeholder title="Review" phase={2} />,
      },
      { path: '/projects', element: <Projects /> },
      { path: '/projects/:owner/:repo', element: <ProjectEditor /> },
      { path: '/history', element: <Placeholder title="History" phase={4} /> },
      { path: '/settings', element: <Settings /> },
      { path: '*', element: <Placeholder title="Not found" phase={0} /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
