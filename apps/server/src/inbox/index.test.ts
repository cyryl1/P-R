import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDataPaths } from '../config/index.js';
import { ReviewDatabase } from '../db/index.js';
import type { GhClient, GhPr } from '../gh/client.js';
import { saveRules } from '../rules/index.js';
import { InboxService } from './index.js';

const pr: GhPr = {
  number: 42,
  title: 'Fix invoices',
  body: 'Fixes #41',
  author: { login: 'octocat' },
  url: 'https://github.com/acme/billing/pull/42',
  baseRefName: 'main',
  headRefName: 'fix/invoices',
  headRefOid: 'deadbeef',
  isDraft: false,
  additions: 2,
  deletions: 1,
  files: [],
  closingIssuesReferences: [],
  state: 'OPEN',
};

const databases: ReviewDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('inbox', () => {
  it('hydrates an empty database from live review requests and reports rules state', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-inbox-'));
    const paths = resolveDataPaths({ PR_REVIEWER_HOME: home });
    const searchReviewRequests = vi.fn(async () => [
      {
        number: 42,
        title: pr.title,
        repository: { nameWithOwner: 'acme/billing' },
        url: pr.url,
        author: pr.author,
        isDraft: false,
        updatedAt: '2026-10-25T10:00:00Z',
      },
    ]);
    const gh = {
      searchReviewRequests,
      getPr: async () => pr,
    } as unknown as GhClient;
    const database = await ReviewDatabase.open(paths.database);
    databases.push(database);
    const inbox = new InboxService(database, gh, paths);

    await expect(inbox.list()).resolves.toEqual([
      expect.objectContaining({
        pr: expect.objectContaining({
          repo: 'acme/billing',
          number: 42,
          headSha: 'deadbeef',
        }),
        rulesState: 'none',
        isStale: false,
      }),
    ]);

    await saveRules(
      paths,
      'acme/billing',
      `version: 1
repo: acme/billing
enabled: true
review: {}
rules: []
`,
    );
    await expect(inbox.list()).resolves.toEqual([
      expect.objectContaining({ rulesState: 'ok' }),
    ]);
    expect(searchReviewRequests).toHaveBeenCalledTimes(1);
  });
});
