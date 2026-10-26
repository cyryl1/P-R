import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderApp } from '@/test-utils';

describe('Projects', () => {
  it('lists projects with their validity and rule counts', async () => {
    renderApp('/projects');
    const row = (await screen.findByRole('link', { name: 'acme/web' })).closest(
      'tr',
    )!;
    expect(within(row).getByText(/Invalid · 2 errors/)).toBeInTheDocument();
    const ok = screen
      .getByRole('link', { name: 'acme/payments-api' })
      .closest('tr')!;
    expect(within(ok).getByText('Valid')).toBeInTheDocument();
    expect(within(ok).getByText('6')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    server.use(http.get('/api/projects', () => HttpResponse.json([])));
    renderApp('/projects');
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
  });

  it('shows an error with retry when the backend fails', async () => {
    server.use(http.get('/api/projects', () => HttpResponse.error()));
    renderApp('/projects');
    expect(
      await screen.findByText(
        /Cannot reach the backend/,
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('only accepts owner/repo and opens the editor with the template', async () => {
    const user = userEvent.setup();
    const router = renderApp('/projects');
    await user.click(
      await screen.findByRole('button', { name: /New project/ }),
    );
    const input = screen.getByLabelText('Repository');
    await user.type(input, 'nonsense');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(screen.getByText('Use the form owner/repo.')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'acme/new');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(router.state.location.pathname).toBe('/projects/acme/new');
    expect(
      await screen.findByText(/New rules file — not saved yet/),
    ).toBeInTheDocument();
  });
});
