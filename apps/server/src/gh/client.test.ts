import { describe, expect, it, vi } from 'vitest';
import { createGhClient, type GhRun } from './client.js';
import { GhAuthError, GhNotFoundError, GhRateLimitError, mapGhError } from './errors.js';
import { ghPrFixture, ghSearchFixture, diffCases } from '../test/fixtures/diff-cases.js';

describe('GitHub CLI wrapper', () => {
  it('exposes typed reads and passes arguments without shell interpolation', async () => {
    const run = vi.fn<GhRun>(async (args) => {
      if (args[0] === 'api' && args[1] === 'user') return 'octocat\n';
      if (args[0] === 'search') return JSON.stringify(ghSearchFixture);
      if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify(ghPrFixture);
      if (args[0] === 'pr' && args[1] === 'diff') return diffCases.multiHunk;
      if (args[0] === 'api' && args[1]?.includes('/contents/')) return 'file contents';
      if (args.includes('--paginate')) return '[]';
      return '{}';
    });
    const gh = createGhClient(run);
    await expect(gh.authStatus()).resolves.toEqual({ login: 'octocat' });
    await expect(gh.searchReviewRequests()).resolves.toEqual(ghSearchFixture);
    await expect(gh.searchReviewRequests({ teams: true })).resolves.toEqual(ghSearchFixture);
    await expect(gh.getPr('acme/billing', 42)).resolves.toEqual(ghPrFixture);
    await expect(gh.getDiff('acme/billing', 42)).resolves.toBe(diffCases.multiHunk);
    await expect(gh.getFile('acme/billing', 'src/user supplied.ts', 'deadbeef')).resolves.toBe('file contents');
    await expect(gh.listReviews('acme/billing', 42)).resolves.toEqual([]);
    expect(run).toHaveBeenCalledWith(['search', 'prs', 'user-review-requested:@me', '--state=open', '--json', 'number,title,repository,url,author,isDraft,updatedAt', '--limit', '100']);
    expect(run).toHaveBeenCalledWith(['api', 'repos/acme/billing/contents/src/user%20supplied.ts?ref=deadbeef', '-H', 'Accept: application/vnd.github.raw']);
  });

  it('sends review payloads through stdin', async () => {
    const run = vi.fn<GhRun>(async () => '{}');
    const gh = createGhClient(run);
    await gh.createReview('acme/billing', 42, { body: 'Review body', comments: [] });
    await gh.submitReview('acme/billing', 42, 7, 'REQUEST_CHANGES', 'Review body');
    await gh.deletePendingReview('acme/billing', 42, 7);
    expect(run.mock.calls[0]?.[0]).toEqual(['api', 'repos/acme/billing/pulls/42/reviews', '-X', 'POST', '--input', '-']);
    expect(run.mock.calls[0]?.[1]).toEqual({ input: JSON.stringify({ body: 'Review body', comments: [] }) });
    expect(run.mock.calls[1]?.[1]).toEqual({ input: JSON.stringify({ event: 'REQUEST_CHANGES', body: 'Review body' }) });
    expect(run.mock.calls[2]?.[0]).toEqual(['api', 'repos/acme/billing/pulls/42/reviews/7', '-X', 'DELETE']);
  });

  it('maps common gh failures to typed errors', () => {
    expect(mapGhError({ message: 'Not logged in to any GitHub hosts' })).toBeInstanceOf(GhAuthError);
    expect(mapGhError({ stderr: 'HTTP 404 Not Found' })).toBeInstanceOf(GhNotFoundError);
    expect(mapGhError({ stderr: 'API rate limit exceeded' })).toBeInstanceOf(GhRateLimitError);
  });
});
