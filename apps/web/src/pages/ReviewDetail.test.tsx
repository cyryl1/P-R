import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderApp } from '@/test-utils';

describe('Review detail', () => {
  it('shows header, rules (failures first), truncation notice and unanchored comments', async () => {
    renderApp('/reviews/rev_draft_ready');
    expect(await screen.findByText('Add refund endpoint')).toBeInTheDocument();
    expect(
      screen.getByText('acme/payments-api#128', { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/openrouter\/free · 18840 tokens/),
    ).toBeInTheDocument();
    const rules = within(screen.getByRole('list', { name: 'Rule checklist' }));
    const items = rules.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/^auth-on-endpoints/);
    expect(items[1]).toMatch(/^tests-for-logic/);
    expect(screen.getByRole('note')).toHaveTextContent('Dropped yarn.lock');
    const unanchored = within(
      screen.getByRole('list', { name: 'Unanchored comments' }),
    );
    expect(unanchored.getByText(/is unanchored\./)).toBeInTheDocument();
  });

  it('renders comments inline under their line, with the unanchored one only in the rail', async () => {
    renderApp('/reviews/rev_draft_ready');
    const file = await screen.findByRole('region', {
      name: 'src/routes/refunds.ts',
    });
    expect(
      await within(file).findByText(/missing/, { selector: 'p' }),
    ).toBeInTheDocument();
    expect(within(file).getAllByRole('article')).toHaveLength(3);
    expect(screen.getAllByText(/is unanchored\./)).toHaveLength(1);
  });

  it('shows binary placeholder and collapses files without hunks', async () => {
    const user = userEvent.setup();
    renderApp('/reviews/rev_draft_ready');
    const binary = await screen.findByRole('region', {
      name: 'assets/logo.png',
    });
    expect(
      within(binary).getByText('Binary file not shown.'),
    ).toBeInTheDocument();
    const lock = screen.getByRole('region', { name: 'yarn.lock' });
    expect(within(lock).getByText('ignored by rules')).toBeInTheDocument();
    const toggle = within(lock).getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('adds a comment from a commentable line', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.use(
      http.post('/api/reviews/:id/comments', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({
          id: 'c_new',
          source: 'user',
          included: true,
          anchorStatus: 'valid',
          ...(sent as object),
        });
      }),
    );
    renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('button', { name: 'Add comment on line 13' }),
    );
    await user.type(
      screen.getByLabelText('New comment'),
      'Nice default export',
    );
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() =>
      expect(sent).toEqual({
        path: 'src/routes/refunds.ts',
        line: 13,
        side: 'RIGHT',
        body: 'Nice default export',
        severity: 'minor',
      }),
    );
  });

  it('edits severity and inclusion through PATCH', async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    server.use(
      http.patch('/api/reviews/:id/comments/:cid', async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderApp('/reviews/rev_draft_ready');
    const [first] = await screen.findAllByRole('combobox', {
      name: 'Severity',
    });
    // First card in DOM order is the excluded user comment on the deleted line.
    await user.selectOptions(first!, 'major');
    await user.click(screen.getAllByLabelText('Include')[0]!);
    await waitFor(() =>
      expect(sent).toEqual([{ severity: 'major' }, { included: true }]),
    );
  });

  it('saves summary on blur', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.use(
      http.patch('/api/reviews/:id', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          (await import('@/mocks/fixtures')).reviewDetail('draft_ready'),
        );
      }),
    );
    renderApp('/reviews/rev_draft_ready');
    const summary = await screen.findByLabelText('Summary');
    await user.clear(summary);
    await user.type(summary, 'Looks fine');
    await user.tab();
    await waitFor(() => expect(sent).toEqual({ summary: 'Looks fine' }));
  });

  it('is read-only once published', async () => {
    renderApp('/reviews/rev_published_pending');
    expect(await screen.findByText(/read-only/)).toBeInTheDocument();
    expect(screen.getByLabelText('Summary')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Verdict')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Add comment on/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Severity' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Open on GitHub' }),
    ).toBeInTheDocument();
  });

  it('shows the stale banner and still allows editing', async () => {
    renderApp('/reviews/rev_stale');
    expect(
      await screen.findByText(/New commits since this draft/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Re-run review' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Summary')).not.toHaveAttribute('readonly');
  });

  it('shows progress while generating', async () => {
    renderApp('/reviews/rev_reviewing');
    expect(await screen.findByText(/Review is reviewing/)).toBeInTheDocument();
  });

  it('shows the failure reason with retry', async () => {
    renderApp('/reviews/rev_failed');
    expect(await screen.findByText(/failed validation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows an error state for an unknown review', async () => {
    renderApp('/reviews/nope');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('dismisses only after confirmation', async () => {
    const user = userEvent.setup();
    let dismissed = false;
    server.use(
      http.post('/api/reviews/:id/dismiss', () => {
        dismissed = true;
        return HttpResponse.json({});
      }),
    );
    renderApp('/reviews/rev_draft_ready');
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(dismissed).toBe(false);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Dismiss',
      }),
    );
    await waitFor(() => expect(dismissed).toBe(true));
  });
});

describe('Review a PR by URL', () => {
  it('creates a review and opens it', async () => {
    const user = userEvent.setup();
    const router = renderApp('/');
    const submit = await screen.findByRole('button', { name: 'Review' });
    expect(submit).toBeDisabled();
    await user.type(
      screen.getByLabelText('Pull request URL'),
      'https://github.com/acme/payments-api/pull/128',
    );
    await user.click(submit);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/reviews/rev_new'),
    );
  });

  it('shows the backend error', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/reviews', () =>
        HttpResponse.json(
          { error: { code: 'GH_NOT_AUTHENTICATED', message: 'x' } },
          { status: 401 },
        ),
      ),
    );
    renderApp('/');
    await user.type(
      await screen.findByLabelText('Pull request URL'),
      'https://github.com/acme/payments-api/pull/1',
    );
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('gh auth login');
  });
});
