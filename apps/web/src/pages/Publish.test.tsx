import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { errorResponses } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { renderApp } from '@/test-utils';

const success = {
  status: 'published_pending',
  githubReviewUrl: 'https://github.com/acme/payments-api/pull/128#r1',
  publishedComments: 2,
  foldedIntoSummary: 1,
};

function capturePublish(
  respond: (n: number) => Response = () => HttpResponse.json(success),
) {
  const sent: unknown[] = [];
  server.use(
    http.post('/api/reviews/:id/publish', async ({ request }) => {
      sent.push(await request.json());
      return respond(sent.length);
    }),
  );
  return sent;
}

const conflict = (code: 'HEAD_MOVED' | 'PENDING_EXISTS') =>
  HttpResponse.json(
    { error: { code, message: errorResponses[code].message } },
    { status: 409 },
  );

describe('Publish flow', () => {
  it('publishes as a pending review by default and reports what was folded', async () => {
    const user = userEvent.setup();
    const sent = capturePublish();
    renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('button', { name: 'Publish as pending review' }),
    );
    await waitFor(() => expect(sent).toEqual([{ mode: 'pending' }]));
    expect(
      await screen.findByText(/Pending review created · 2 inline comments/),
    ).toHaveTextContent('1 comment folded into the summary');
    expect(
      screen.getByRole('link', { name: 'Open on GitHub' }),
    ).toHaveAttribute('href', success.githubReviewUrl);
  });

  it('never submits without confirmation, and the dialog repeats verdict and comment count', async () => {
    const user = userEvent.setup();
    const sent = capturePublish();
    renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('button', { name: 'Submit now…' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Request changes');
    expect(dialog).toHaveTextContent('3 comments');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sent).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Submit now…' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Submit review',
      }),
    );
    await waitFor(() =>
      expect(sent).toEqual([{ mode: 'submit', event: 'REQUEST_CHANGES' }]),
    );
    expect(await screen.findByText(/Review submitted/)).toBeInTheDocument();
  });

  it('offers to publish anyway when the head moved, then forces', async () => {
    const user = userEvent.setup();
    const sent = capturePublish((n) =>
      n === 1 ? conflict('HEAD_MOVED') : HttpResponse.json(success),
    );
    renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('button', { name: 'Publish as pending review' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('pushed new commits');
    await user.click(
      within(dialog).getByRole('button', { name: 'Publish anyway' }),
    );
    await waitFor(() =>
      expect(sent).toEqual([
        { mode: 'pending' },
        { mode: 'pending', force: true },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('re-runs the review from the head-moved dialog and opens the new one', async () => {
    const user = userEvent.setup();
    capturePublish(() => conflict('HEAD_MOVED'));
    const router = renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('button', { name: 'Publish as pending review' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Re-run review',
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/reviews/rev_rerun'),
    );
  });

  it('asks before replacing an existing pending review', async () => {
    const user = userEvent.setup();
    const sent = capturePublish((n) =>
      n === 1 ? conflict('PENDING_EXISTS') : HttpResponse.json(success),
    );
    renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('button', { name: 'Publish as pending review' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('already have a pending review');
    await user.click(
      within(dialog).getByRole('button', { name: 'Replace pending review' }),
    );
    await waitFor(() =>
      expect(sent).toEqual([
        { mode: 'pending' },
        { mode: 'pending', replacePending: true },
      ]),
    );
  });

  it('keeps submit mode when recovering from a conflict', async () => {
    const user = userEvent.setup();
    const sent = capturePublish((n) =>
      n === 1 ? conflict('PENDING_EXISTS') : HttpResponse.json(success),
    );
    renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('button', { name: 'Submit now…' }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Submit review',
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Replace pending review' }),
    );
    await waitFor(() =>
      expect(sent).toEqual([
        { mode: 'submit', event: 'REQUEST_CHANGES' },
        { mode: 'submit', event: 'REQUEST_CHANGES', replacePending: true },
      ]),
    );
  });

  it('shows other errors as a toast and offers no publish after publishing', async () => {
    const user = userEvent.setup();
    capturePublish(() =>
      HttpResponse.json(
        { error: { code: 'GH_RATE_LIMITED', message: 'x' } },
        { status: 429 },
      ),
    );
    renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('button', { name: 'Publish as pending review' }),
    );
    expect(await screen.findByText(/rate limiting/)).toBeInTheDocument();
  });

  it('hides publish actions once the review is published', async () => {
    renderApp('/reviews/rev_published_pending');
    await screen.findByText(/read-only/);
    expect(
      screen.queryByRole('button', { name: 'Publish as pending review' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit now…' })).toBeNull();
    expect(
      screen.getAllByRole('link', { name: 'Open on GitHub' }).length,
    ).toBeGreaterThan(0);
  });
});
