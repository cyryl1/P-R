import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { applyEvent } from '@/api/events';
import { makeQueryClient } from '@/App';
import { diffFiles, reviewDetail, reviewSummary } from '@/mocks/fixtures';
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

  it('lists comments to post and previews them under their line', async () => {
    const user = userEvent.setup();
    renderApp('/reviews/rev_draft_ready');
    expect(
      await screen.findByRole('heading', { name: 'Comments to post' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/is unanchored\./)).toHaveLength(2);
    await user.click(screen.getByRole('tab', { name: /Changes/ }));
    const file = await screen.findByRole('region', {
      name: 'src/routes/refunds.ts',
    });
    expect(
      await within(file).findByText(/missing/, { selector: 'p' }),
    ).toBeInTheDocument();
    expect(within(file).getAllByRole('article')).toHaveLength(3);
  });

  it('shows binary placeholder and collapses files without hunks', async () => {
    const user = userEvent.setup();
    renderApp('/reviews/rev_draft_ready?tab=changes');
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
    renderApp('/reviews/rev_draft_ready?tab=changes');
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
    // First card in the list is the first comment from the server.
    await user.selectOptions(first!, 'major');
    await user.click(screen.getAllByLabelText('Include')[0]!);
    await waitFor(() =>
      expect(sent).toEqual([{ severity: 'major' }, { included: false }]),
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
    await user.click(
      await screen.findByRole('button', { name: 'Edit summary' }),
    );
    const summary = screen.getByLabelText('Summary');
    await user.clear(summary);
    await user.type(summary, 'Looks fine');
    await user.tab();
    await waitFor(() => expect(sent).toEqual({ summary: 'Looks fine' }));
  });

  it('is read-only once published', async () => {
    renderApp('/reviews/rev_published_pending');
    expect(await screen.findByText(/read-only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit summary' })).toBeNull();
    expect(screen.queryByLabelText('Summary')).toBeNull();
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
    expect(
      screen.getByRole('button', { name: 'Edit summary' }),
    ).toBeInTheDocument();
  });

  it('shows progress while generating', async () => {
    renderApp('/reviews/rev_reviewing');
    expect(await screen.findByText(/Review is reviewing/)).toBeInTheDocument();
  });

  it('swaps progress for the draft when a review.updated event arrives', async () => {
    const qc = makeQueryClient();
    renderApp('/reviews/rev_reviewing', qc);
    expect(await screen.findByText(/Review is reviewing/)).toBeInTheDocument();

    server.use(
      http.get('/api/reviews/:id', () =>
        HttpResponse.json(reviewDetail('draft_ready')),
      ),
    );
    act(() =>
      applyEvent(qc, {
        type: 'review.updated',
        data: reviewSummary('draft_ready', { id: 'rev_reviewing' }),
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Summary' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Review is reviewing/)).toBeNull();
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

  it('moves between comments with j and k, but not while typing', async () => {
    const user = userEvent.setup();
    renderApp('/reviews/rev_draft_ready');
    const cards = await screen.findAllByRole('article');
    await user.keyboard('j');
    expect(cards[0]).toHaveFocus();
    await user.keyboard('j');
    expect(cards[1]).toHaveFocus();
    await user.keyboard('k');
    expect(cards[0]).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Edit summary' }));
    await user.keyboard('j');
    expect(screen.getByLabelText('Summary')).toHaveFocus();
  });

  it('saves the summary with Cmd+Enter', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.use(
      http.patch('/api/reviews/:id', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(reviewDetail('draft_ready'));
      }),
    );
    renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('button', { name: 'Edit summary' }),
    );
    const summary = screen.getByLabelText('Summary');
    await user.type(summary, '!');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(sent).toMatchObject({ summary: expect.stringMatching(/!$/) }),
    );
  });

  it('submits a new comment with Cmd+Enter and cancels with Escape', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.use(
      http.post('/api/reviews/:id/comments', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({});
      }),
    );
    renderApp('/reviews/rev_draft_ready?tab=changes');
    await user.click(
      await screen.findByRole('button', { name: 'Add comment on line 13' }),
    );
    await user.type(screen.getByLabelText('New comment'), 'Hi');
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('New comment')).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Add comment on line 13' }),
    );
    await user.type(screen.getByLabelText('New comment'), 'Hi');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(sent).toMatchObject({ body: 'Hi', line: 13 }));
  });

  it('on a large PR only opens files that have comments, and can expand all', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...diffFiles[0]!,
      path: i === 3 ? 'src/routes/refunds.ts' : `src/file${i}.ts`,
    }));
    server.use(
      http.get('/api/reviews/:id/diff', () => HttpResponse.json(many)),
    );
    renderApp('/reviews/rev_draft_ready?tab=changes');
    const commented = await screen.findByRole('region', {
      name: 'src/routes/refunds.ts',
    });
    expect(
      within(commented).getByRole('button', { name: /src\/routes/ }),
    ).toHaveAttribute('aria-expanded', 'true');
    const other = screen.getByRole('region', { name: 'src/file0.ts' });
    expect(
      within(other).getByRole('button', { name: /src\/file0\.ts/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(
      within(other).getByRole('button', { name: /src\/file0\.ts/ }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('jumps to a file from the file list, opening it first', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...diffFiles[0]!,
      path: i === 3 ? 'src/routes/refunds.ts' : `src/file${i}.ts`,
    }));
    server.use(
      http.get('/api/reviews/:id/diff', () => HttpResponse.json(many)),
    );
    renderApp('/reviews/rev_draft_ready?tab=changes');
    const index = await screen.findByRole('navigation', {
      name: 'Changed files',
    });
    const target = screen.getByRole('region', { name: 'src/file7.ts' });
    expect(
      within(target).getByRole('button', { name: /src\/file7\.ts/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    await user.type(within(index).getByLabelText('Filter files'), 'file7');
    expect(within(index).getAllByRole('button')).toHaveLength(1);
    await user.click(within(index).getByRole('button', { name: /file7/ }));
    expect(
      within(target).getByRole('button', { name: /src\/file7\.ts/ }),
    ).toHaveAttribute('aria-expanded', 'true');

    await user.clear(within(index).getByLabelText('Filter files'));
    await user.click(within(index).getByLabelText('With comments'));
    expect(within(index).getAllByRole('button')).toHaveLength(1);
    expect(within(index).getByRole('button')).toHaveAccessibleName(
      'src/routes/refunds.ts',
    );
  });

  it('offers a way back when the review does not exist', async () => {
    renderApp('/reviews/nope');
    expect(
      await screen.findByRole('link', { name: 'Back to Inbox' }),
    ).toBeInTheDocument();
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

describe('PR status and questions', () => {
  it('shows merge status, GitHub comments and reviews, and CI checks', async () => {
    renderApp('/reviews/rev_draft_ready');
    expect(await screen.findByText('Merge conflicts')).toBeInTheDocument();
    expect(screen.getByText('2 comments')).toBeInTheDocument();
    const reviews = within(
      screen.getByRole('list', { name: 'GitHub reviews' }),
    );
    expect(reviews.getByText('hubot')).toBeInTheDocument();
    expect(reviews.getByText('changes requested')).toBeInTheDocument();
    const checks = within(screen.getByRole('list', { name: 'CI checks' }));
    expect(checks.getAllByRole('listitem')).toHaveLength(3);
    expect(
      checks.getByRole('link', { name: 'integration (1/3)' }),
    ).toHaveAttribute('href', 'https://ci.example/1');
  });

  it('answers a question about the PR without touching the review', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.use(
      http.post('/api/reviews/:id/ask', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ answer: 'It adds **refunds**.' });
      }),
    );
    renderApp('/reviews/rev_draft_ready');
    const box = await screen.findByLabelText('Ask about this pull request');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    await user.type(box, 'What changed?{Enter}');
    const answer = await screen.findByRole('region', { name: 'Answer' });
    expect(within(answer).getByText('refunds')).toBeInTheDocument();
    expect(sent).toEqual({ question: 'What changed?' });
    expect(box).toHaveValue('');
    await user.click(
      within(answer).getByRole('button', { name: 'Close answer' }),
    );
    expect(screen.queryByRole('region', { name: 'Answer' })).toBeNull();
  });

  it('shows why a question failed and keeps it for retrying', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/reviews/:id/ask', () =>
        HttpResponse.json(
          { error: { code: 'LLM_FAILED', message: 'The model timed out.' } },
          { status: 502 },
        ),
      ),
    );
    renderApp('/reviews/rev_draft_ready');
    await user.type(
      await screen.findByLabelText('Ask about this pull request'),
      'Why?{Enter}',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The model timed out.',
    );
    expect(screen.getByLabelText('Ask about this pull request')).toHaveValue(
      'Why?',
    );
  });
});

describe('Leave a comment on the PR', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    renderApp('/reviews/rev_draft_ready');
    await user.click(
      await screen.findByRole('tab', { name: 'Leave a comment' }),
    );
    return screen.getByLabelText('Leave a comment', { selector: 'textarea' });
  };

  it('posts only after the confirmation dialog, then clears the box', async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    server.use(
      http.post('/api/reviews/:id/github-comments', async ({ request }) => {
        const body = (await request.json()) as { body: string };
        sent.push(body);
        return HttpResponse.json({
          id: 'c1',
          url: 'https://github.com/acme/payments-api/pull/128#issuecomment-9',
          body: body.body,
          author: 'octocat',
          createdAt: '2026-11-05T10:00:00Z',
        });
      }),
    );
    const box = await open(user);
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled();
    await user.type(box, 'Looks good, one question.');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/immediately/);
    expect(sent).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sent).toEqual([]);
    expect(box).toHaveValue('Looks good, one question.');

    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Post comment',
      }),
    );
    await waitFor(() =>
      expect(sent).toEqual([
        { body: 'Looks good, one question.', confirm: true },
      ]),
    );
    expect(
      await screen.findByRole('link', { name: /View on GitHub/ }),
    ).toHaveAttribute(
      'href',
      'https://github.com/acme/payments-api/pull/128#issuecomment-9',
    );
    expect(box).toHaveValue('');
  });

  it('keeps the text and shows the reason when posting fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/reviews/:id/github-comments', () =>
        HttpResponse.json(
          { error: { code: 'GH_RATE_LIMITED', message: 'x' } },
          { status: 429 },
        ),
      ),
    );
    const box = await open(user);
    await user.type(box, 'Hello');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Post comment',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('rate limiting');
    expect(box).toHaveValue('Hello');
  });
});

describe('Review a PR by URL', () => {
  it('creates a review and opens it', async () => {
    const user = userEvent.setup();
    const router = renderApp('/');
    const box = await screen.findByLabelText('Search or paste a PR link');
    await user.type(
      box,
      'https://github.com/acme/payments-api/pull/128{Enter}',
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/reviews/rev_new'),
    );
  });

  it('shows progress while the review runs', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/reviews', async () => {
        await new Promise((r) => setTimeout(r, 300));
        return HttpResponse.json({ id: 'rev_new' });
      }),
    );
    renderApp('/');
    await user.type(
      await screen.findByLabelText('Search or paste a PR link'),
      'https://github.com/acme/payments-api/pull/1{Enter}',
    );
    expect(await screen.findByText(/can take a minute or two/)).toBeVisible();
    expect(screen.getByLabelText('Search or paste a PR link')).toBeDisabled();
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
      await screen.findByLabelText('Search or paste a PR link'),
      'https://github.com/acme/payments-api/pull/1{Enter}',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('gh auth login');
  });
});
