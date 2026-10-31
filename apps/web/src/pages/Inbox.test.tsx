import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { reviewSummary } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { renderApp } from '@/test-utils';

const rowFor = async (title: string) =>
  (await screen.findByRole('link', { name: new RegExp(title) })).closest('tr')!;

describe('Inbox', () => {
  it('lists PRs with status badges and the right action for each', async () => {
    renderApp('/');
    const draft = await rowFor('Add refund endpoint');
    expect(within(draft).getByText('Draft ready')).toBeInTheDocument();
    expect(
      within(draft).getByRole('link', { name: 'Open draft' }),
    ).toHaveAttribute('href', '/reviews/rev_draft_ready');

    const stale = await rowFor('Fix rounding');
    expect(within(stale).getByText('Stale')).toBeInTheDocument();

    expect(
      within(await rowFor('Redesign settings')).getByText('Rules invalid'),
    ).toBeInTheDocument();
    expect(
      within(await rowFor('Add CLI flag')).getByRole('link', {
        name: 'Add rules',
      }),
    ).toHaveAttribute('href', '/projects/acme/tools');
    expect(
      within(await rowFor('Publish test')).getByRole('link', {
        name: 'Open on GitHub',
      }),
    ).toBeInTheDocument();
  });

  it('links the PR title to GitHub', async () => {
    renderApp('/');
    expect(
      await screen.findByRole('link', { name: /Add refund endpoint/ }),
    ).toHaveAttribute('href', 'https://github.com/acme/payments-api/pull/128');
  });

  it('starts a review from "Review now" and opens it', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.use(
      http.post('/api/reviews', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(reviewSummary('queued', { id: 'rev_new' }));
      }),
    );
    const router = renderApp('/');
    await user.click(
      within(await rowFor('Bump deps')).getByRole('button', {
        name: 'Review now',
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/reviews/rev_new'),
    );
    expect(sent).toEqual({
      prUrl: 'https://github.com/acme/payments-api/pull/130',
    });
  });

  it('retries a failed review and shows the error as a tooltip', async () => {
    const user = userEvent.setup();
    const router = renderApp('/');
    const retry = within(await rowFor('WIP: webhooks')).getByRole('button', {
      name: 'Retry',
    });
    expect(retry).toHaveAttribute(
      'title',
      expect.stringContaining('failed validation'),
    );
    await user.click(retry);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/reviews/rev_rerun'),
    );
  });

  it('shows the empty state with the last poll time', async () => {
    server.use(http.get('/api/inbox', () => HttpResponse.json([])));
    renderApp('/');
    expect(
      await screen.findByText('Nothing is waiting on you'),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/Last checked 2 min ago/)).length,
    ).toBeGreaterThan(0);
  });

  it('shows an error with retry when the inbox fails', async () => {
    server.use(
      http.get('/api/inbox', () =>
        HttpResponse.json(
          { error: { code: 'GH_NOT_AUTHENTICATED', message: 'x' } },
          { status: 401 },
        ),
      ),
    );
    renderApp('/');
    expect(await screen.findByText(/gh auth login/)).toBeInTheDocument();
  });
});
