import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfigSchema } from '@pr-reviewer/shared';
import { resolveDataPaths } from '../config/index.js';
import { ReviewDatabase } from '../db/index.js';
import type { GhClient, GhPr, GhReviewPayload } from '../gh/client.js';
import { MockProvider } from '../llm/mock.js';
import { ReviewService } from '../review/index.js';
import { saveRules } from '../rules/index.js';
import { PendingExistsError, PublishService } from './index.js';

const diff = `diff --git a/src/pay.ts b/src/pay.ts
--- a/src/pay.ts
+++ b/src/pay.ts
@@ -1 +1,2 @@
 export const pay = () => true;
+export const refund = () => false;
`;
const initialPr: GhPr = {
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

const databases: ReviewDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-publish-'));
  const paths = resolveDataPaths({ PR_REVIEWER_HOME: home });
  await saveRules(
    paths,
    'acme/billing',
    `version: 1
repo: acme/billing
enabled: true
review:
  max_comments: 5
  min_severity: minor
rules:
  - id: tests
    type: require_tests
    when_paths: [src/**]
    test_paths: ['**/*.test.ts']
    severity: major
`,
  );
  let currentPr = initialPr;
  let reviews: Awaited<ReturnType<GhClient['listReviews']>> = [];
  let createdPayload: GhReviewPayload | undefined;
  const deletePendingReview = vi.fn(async () => undefined);
  const gh: GhClient = {
    authStatus: async () => ({ login: 'octo' }),
    searchReviewRequests: async () => [],
    getPr: async () => currentPr,
    getDiff: async () => diff,
    getFile: async () => '',
    listReviews: async () => reviews,
    createReview: async (_repo, _number, payload) => {
      createdPayload = payload;
      return {
        id: 99,
        state: payload.event ? 'COMMENTED' : 'PENDING',
        html_url: 'https://github.com/acme/billing/pull/7#pullrequestreview-99',
      };
    },
    submitReview: async () => ({ id: 99, state: 'COMMENTED' }),
    deletePendingReview,
  };
  const database = await ReviewDatabase.open(paths.database);
  databases.push(database);
  const service = new ReviewService(
    database,
    gh,
    new MockProvider(),
    paths,
    AppConfigSchema.parse({ llm: { provider: 'mock', model: 'mock' } }),
  );
  const generated = await service.create(initialPr.url);
  return {
    service,
    database,
    publisher: new PublishService(database, gh),
    generated,
    setPr: (pr: GhPr) => {
      currentPr = pr;
    },
    setReviews: (next: typeof reviews) => {
      reviews = next;
    },
    payload: () => createdPayload,
    deletePendingReview,
  };
}

describe('review publishing', () => {
  it('publishes valid anchors, folds invalid anchors, and renders suggestions', async () => {
    const { service, publisher, generated, payload } = await fixture();
    const generatedComment = service.get(generated.id).comments[0]!;
    await service.editComment(generated.id, generatedComment.id, {
      suggestion: 'export const refund = () => true;',
    });
    await service.addComment(generated.id, {
      path: 'src/pay.ts',
      line: 999,
      side: 'RIGHT',
      severity: 'major',
      body: 'This anchor no longer exists.',
    });

    await expect(
      publisher.publish(generated.id, { mode: 'pending' }),
    ).resolves.toMatchObject({
      status: 'published_pending',
      publishedComments: 1,
      foldedIntoSummary: 1,
    });
    expect(payload()).toMatchObject({
      commit_id: 'abc123',
      comments: [
        expect.objectContaining({
          path: 'src/pay.ts',
          line: 2,
          body: expect.stringContaining('```suggestion'),
        }),
      ],
    });
    expect(payload()?.event).toBeUndefined();
    expect(payload()?.body).toContain('### Failed checks');
    expect(payload()?.body).toContain(
      '### Comments without valid diff anchors',
    );
    expect(service.get(generated.id).status).toBe('published_pending');
  });

  it('requires force when the PR head moved', async () => {
    const { publisher, generated, setPr } = await fixture();
    setPr({ ...initialPr, headRefOid: 'new-head' });
    await expect(
      publisher.publish(generated.id, { mode: 'pending' }),
    ).rejects.toMatchObject({
      code: 'HEAD_MOVED',
      currentHeadSha: 'new-head',
    });
  });

  it('detects and can replace the current user pending review', async () => {
    const { publisher, generated, setReviews, deletePendingReview, payload } =
      await fixture();
    setReviews([
      {
        id: 17,
        state: 'PENDING',
        user: { login: 'octo' },
        html_url: 'https://github.com/acme/billing/pull/7#pullrequestreview-17',
      },
    ]);
    await expect(
      publisher.publish(generated.id, { mode: 'pending' }),
    ).rejects.toBeInstanceOf(PendingExistsError);

    await expect(
      publisher.publish(generated.id, {
        mode: 'submit',
        event: 'REQUEST_CHANGES',
        replacePending: true,
      }),
    ).resolves.toMatchObject({ status: 'submitted' });
    expect(deletePendingReview).toHaveBeenCalledWith('acme/billing', 7, 17);
    expect(payload()?.event).toBe('REQUEST_CHANGES');
  });
});
