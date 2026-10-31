import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfigSchema } from '@pr-reviewer/shared';
import { createServer } from '../index.js';
import { resolveDataPaths } from '../config/index.js';
import { ReviewDatabase } from '../db/index.js';
import type { GhClient, GhPr } from '../gh/client.js';
import { MockProvider } from '../llm/mock.js';
import { saveRules } from '../rules/index.js';
import {
  ReviewService,
  ReviewStateError,
  reviewTokenBudgets,
} from './index.js';

const diff = `diff --git a/src/pay.ts b/src/pay.ts
--- a/src/pay.ts
+++ b/src/pay.ts
@@ -1 +1,2 @@
 export const pay = () => true;
+export const refund = () => false;
`;
const pr: GhPr = {
  number: 7,
  title: 'Add refunds',
  body: 'Implements #42 with enough context for reviewers.',
  author: { login: 'octo' },
  url: 'https://github.com/acme/billing/pull/7',
  baseRefName: 'main',
  headRefName: 'refunds',
  headRefOid: 'abc123',
  isDraft: false,
  additions: 1,
  deletions: 0,
  files: [],
  closingIssuesReferences: [],
  state: 'OPEN',
};
const gh: GhClient = {
  authStatus: async () => ({ login: 'octo' }),
  searchReviewRequests: async () => [],
  getPr: async () => pr,
  getDiff: async () => diff,
  getFile: async () => 'Review carefully.',
  listReviews: async () => [],
  createReview: async () => ({ id: 1, state: 'PENDING' }),
  submitReview: async () => ({ id: 1, state: 'COMMENTED' }),
  deletePendingReview: async () => undefined,
};

const databases: ReviewDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-phase2-'));
  const paths = resolveDataPaths({ PR_REVIEWER_HOME: home });
  const rules = `version: 1
repo: acme/billing
enabled: true
review:
  max_comments: 3
  min_severity: minor
  context_files: [CONTRIBUTING.md]
rules:
  - id: tests
    type: require_tests
    when_paths: [src/**]
    test_paths: ['**/*.test.ts']
    severity: major
  - id: safety
    type: llm
    description: Check refund safety.
    severity: major
`;
  await saveRules(paths, 'acme/billing', rules);
  const database = await ReviewDatabase.open(paths.database);
  databases.push(database);
  const config = AppConfigSchema.parse({
    llm: { provider: 'mock', model: 'mock' },
  });
  const service = new ReviewService(
    database,
    gh,
    new MockProvider(),
    paths,
    config,
  );
  return { home, paths, database, config, service };
}

describe('review orchestration', () => {
  it('caps free-model token budgets for faster, reliable reviews', () => {
    const config = AppConfigSchema.parse({});
    expect(
      reviewTokenBudgets(config, {
        name: 'openrouter',
        model: 'nvidia/nemotron-3.5-super-vl:free',
      }),
    ).toEqual({
      inputTokens: 24_000,
      outputTokens: 4_000,
      cappedForFreeModel: true,
    });
  });

  it('runs a mock review, persists it, and supports draft editing', async () => {
    const { paths, database, service } = await fixture();
    const summary = await service.create(pr.url);
    expect(summary).toMatchObject({ status: 'draft_ready', commentCount: 1 });
    const detail = service.get(summary.id);
    expect(detail.comments[0]).toMatchObject({
      path: 'src/pay.ts',
      line: 2,
      anchorStatus: 'valid',
    });
    expect(detail.ruleResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'tests', status: 'fail' }),
        expect.objectContaining({ ruleId: 'safety', status: 'unsure' }),
      ]),
    );
    await service.edit(summary.id, {
      verdict: 'REQUEST_CHANGES',
      summary: 'Edited summary.',
    });
    const added = await service.addComment(summary.id, {
      path: 'src/pay.ts',
      line: 2,
      side: 'RIGHT',
      severity: 'major',
      body: 'Handle the failure.',
    });
    await service.editComment(summary.id, added.id, { included: false });
    expect(service.get(summary.id)).toMatchObject({
      verdict: 'REQUEST_CHANGES',
      summary: 'Edited summary.',
    });
    expect(await readFile(paths.database)).not.toHaveLength(0);
    database.close();
    databases.pop();
    const reopened = await ReviewDatabase.open(paths.database);
    databases.push(reopened);
    expect(reopened.getReview(summary.id)?.comments).toHaveLength(2);
  });

  it('returns a queued review immediately and completes it in the background', async () => {
    const { service } = await fixture();
    const queued = await service.enqueue(pr.url);
    expect(queued.status).toBe('queued');
    await vi.waitFor(() => {
      expect(service.get(queued.id).status).toBe('draft_ready');
    });
  });

  it('marks interrupted publishing failed during startup recovery', async () => {
    const { database, service } = await fixture();
    const completed = await service.create(pr.url);
    await database.updateReview(completed.id, { status: 'publishing' });
    await expect(database.recoverInterruptedReviews()).resolves.toBe(1);
    expect(database.getReview(completed.id)).toMatchObject({
      status: 'failed',
      error:
        'Server restarted while publishing; verify GitHub before retrying.',
    });
  });

  it('exposes the review endpoints and enforces editable states', async () => {
    const { paths, config, service } = await fixture();
    const summary = await service.create(pr.url);
    const app = createServer({ paths, config, gh, reviews: service });
    const response = await app.inject({
      method: 'GET',
      url: `/api/reviews/${summary.id}`,
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: summary.id,
      status: 'draft_ready',
    });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/reviews/${summary.id}`,
      headers: { host: 'localhost' },
      payload: { summary: 'API edit' },
    });
    expect(patch.statusCode).toBe(200);
    await service.dismiss(summary.id);
    await expect(
      service.edit(summary.id, { summary: 'too late' }),
    ).rejects.toBeInstanceOf(ReviewStateError);
    await app.close();
  });

  it('returns queued from POST while generation continues', async () => {
    const { paths, config, service } = await fixture();
    const app = createServer({ paths, config, gh, reviews: service });
    const response = await app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { host: 'localhost' },
      payload: { prUrl: pr.url },
    });
    expect(response.statusCode).toBe(200);
    const queued = response.json() as { id: string; status: string };
    expect(queued.status).toBe('queued');
    await vi.waitFor(() => {
      expect(service.get(queued.id).status).toBe('draft_ready');
    });
    await app.close();
  });
});
