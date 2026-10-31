import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { activity, reviewSummary } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { renderApp } from '@/test-utils';

describe('History', () => {
  it('lists reviews, filters by status and pages with Load more', async () => {
    const user = userEvent.setup();
    const limits: (string | null)[] = [];
    server.use(
      http.get('/api/reviews', ({ request }) => {
        const url = new URL(request.url);
        limits.push(url.searchParams.get('status'));
        const cursor = url.searchParams.get('cursor');
        return HttpResponse.json(
          cursor
            ? {
                items: [
                  reviewSummary('failed', { id: 'p2', prTitle: 'Second page' }),
                ],
              }
            : {
                items: [
                  reviewSummary('draft_ready', {
                    id: 'p1',
                    prTitle: 'First page',
                  }),
                ],
                nextCursor: 'c1',
              },
        );
      }),
    );
    renderApp('/history');
    expect(
      await screen.findByRole('link', { name: 'First page' }),
    ).toHaveAttribute('href', '/reviews/p1');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Status'), 'failed');
    await waitFor(() => expect(limits).toContain('failed'));
  });

  it('shows an empty state when nothing matches', async () => {
    server.use(
      http.get('/api/reviews', () => HttpResponse.json({ items: [] })),
    );
    renderApp('/history');
    expect(await screen.findByText('No reviews match.')).toBeInTheDocument();
  });

  it('shows the activity log and filters by level', async () => {
    const user = userEvent.setup();
    renderApp('/history');
    await user.click(await screen.findByRole('tab', { name: 'activity' }));
    const log = await screen.findByRole('list', { name: 'Activity log' });
    expect(within(log).getAllByRole('listitem')).toHaveLength(activity.length);
    expect(
      within(log).getByRole('link', { name: /has new commits/ }),
    ).toHaveAttribute('href', '/reviews/rev_stale');

    await user.selectOptions(screen.getByLabelText('Level'), 'error');
    expect(within(log).getAllByRole('listitem')).toHaveLength(1);
    expect(within(log).getByText(/LLM output failed/)).toBeInTheDocument();
  });
});
