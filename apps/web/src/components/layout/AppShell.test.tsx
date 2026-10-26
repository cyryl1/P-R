import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { makeQueryClient } from '@/App';
import { healthGhLoggedOut, healthNoKey } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { routes } from '@/routes';

function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('AppShell', () => {
  it('shows the sidebar routes and a placeholder page', async () => {
    renderApp('/history');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const name of ['Inbox', 'Projects', 'History', 'Settings'])
      expect(nav).toHaveTextContent(name);
    expect(
      await screen.findByRole('heading', { name: 'History' }),
    ).toBeInTheDocument();
  });

  it('shows the poll indicator from /api/health', async () => {
    renderApp();
    expect(
      await screen.findByText(/Last checked 2 min ago · Next in 3 min/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check now/ })).toBeEnabled();
  });

  it('shows no banner when everything is healthy', async () => {
    renderApp();
    await screen.findByText(/Last checked/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the gh fix when gh is logged out', async () => {
    server.use(
      http.get('/api/health', () => HttpResponse.json(healthGhLoggedOut)),
    );
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('gh auth login');
  });

  it('warns about the mock provider when no API key is set', async () => {
    server.use(http.get('/api/health', () => HttpResponse.json(healthNoKey)));
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'OPENROUTER_API_KEY',
    );
  });

  it('shows an unreachable-backend banner', async () => {
    server.use(http.get('/api/health', () => HttpResponse.error()));
    renderApp();
    expect(
      await screen.findByRole('alert', {}, { timeout: 4000 }),
    ).toHaveTextContent('Cannot reach the backend');
  });
});
