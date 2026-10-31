import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppConfigSchema,
  RulesFileSchema,
  type ServerEvent,
} from '@pr-reviewer/shared';
import { resolveDataPaths } from '../config/index.js';
import { ReviewDatabase } from '../db/index.js';
import { EventHub } from '../events/index.js';
import type { GhClient, GhPr } from '../gh/client.js';
import type { ReviewService } from '../review/index.js';
import { saveRules } from '../rules/index.js';
import { Poller } from './index.js';

const oldPr: GhPr = {
  number: 9,
  title: 'Automate billing',
  body: 'Implements #8 with sufficient context.',
  author: { login: 'octo' },
  url: 'https://github.com/acme/billing/pull/9',
  baseRefName: 'main',
  headRefName: 'billing',
  headRefOid: 'old-head',
  isDraft: false,
  additions: 2,
  deletions: 0,
  files: [],
  closingIssuesReferences: [],
  state: 'OPEN',
};
const search = {
  number: 9,
  title: oldPr.title,
  repository: { nameWithOwner: 'acme/billing' },
  url: oldPr.url,
  author: oldPr.author,
  isDraft: false,
  updatedAt: '2026-10-31T10:00:00Z',
};
const rules = RulesFileSchema.parse({
  version: 1,
  repo: 'acme/billing',
  enabled: true,
});

const databases: ReviewDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function fixture(triggerYaml: string, currentPr: GhPr = oldPr) {
  const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-poller-'));
  const paths = resolveDataPaths({ PR_REVIEWER_HOME: home });
  await saveRules(
    paths,
    'acme/billing',
    `version: 1
repo: acme/billing
enabled: true
triggers:
${triggerYaml}
review: {}
rules: []
`,
  );
  const database = await ReviewDatabase.open(paths.database);
  databases.push(database);
  const events = new EventHub();
  const emitted: ServerEvent[] = [];
  events.subscribe((event) => emitted.push(event));
  const enqueue = vi.fn(async () => ({ id: 'auto-review' }));
  const gh = {
    searchReviewRequests: async () => [search],
    getPr: async () => currentPr,
    listReviews: async () => [],
  } as unknown as GhClient;
  const reviews = { enqueue } as unknown as ReviewService;
  const poller = new Poller(
    database,
    gh,
    reviews,
    paths,
    events,
    AppConfigSchema.parse({}),
  );
  return { paths, database, events, emitted, enqueue, gh, reviews, poller };
}

describe('poller', () => {
  it('hydrates requests, clears missing requests, and auto-enqueues', async () => {
    const { database, emitted, enqueue, poller } = await fixture(
      '  on_review_request: auto\n  on_new_commits: notify\n  skip_drafts: true',
    );
    await database.upsertPr(
      'acme/old',
      { ...oldPr, number: 1 },
      {
        reviewRequested: true,
      },
    );

    await poller.pollNow();

    expect(enqueue).toHaveBeenCalledWith(oldPr.url, 'auto');
    expect(database.listInboxPrs()).toEqual([
      expect.objectContaining({ repo: 'acme/billing', number: 9 }),
    ]);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'inbox.updated', data: { count: 1 } }),
        expect.objectContaining({ type: 'poll.status' }),
      ]),
    );
  });

  it('marks an unpublished older review stale on a new push', async () => {
    const newPr = { ...oldPr, headRefOid: 'new-head' };
    const { database, poller } = await fixture(
      '  on_review_request: manual\n  on_new_commits: notify\n  skip_drafts: true',
      newPr,
    );
    const prId = await database.upsertPr('acme/billing', oldPr);
    const review = await database.createReview({
      prId,
      headSha: oldPr.headRefOid,
      trigger: 'manual',
      rules,
    });
    await database.updateReview(review.id, { status: 'draft_ready' });

    await poller.pollNow();

    expect(database.getReview(review.id)).toMatchObject({ status: 'stale' });
    expect(database.listActivities().items[0]).toMatchObject({
      type: 'review.stale',
      reviewId: review.id,
    });
  });

  it('detects a pending review submitted on GitHub', async () => {
    const { database, paths, events } = await fixture(
      '  on_review_request: manual\n  on_new_commits: ignore\n  skip_drafts: true',
    );
    const prId = await database.upsertPr('acme/billing', oldPr);
    const review = await database.createReview({
      prId,
      headSha: oldPr.headRefOid,
      trigger: 'manual',
      rules,
    });
    await database.updateReview(review.id, {
      status: 'published_pending',
      githubReviewId: '44',
      githubReviewUrl:
        'https://github.com/acme/billing/pull/9#pullrequestreview-44',
      publishedAt: new Date().toISOString(),
    });
    const gh = {
      searchReviewRequests: async () => [],
      listReviews: async () => [{ id: 44, state: 'COMMENTED' }],
    } as unknown as GhClient;
    const poller = new Poller(
      database,
      gh,
      { enqueue: vi.fn() } as unknown as ReviewService,
      paths,
      events,
      AppConfigSchema.parse({}),
    );

    await poller.pollNow();

    expect(database.getReview(review.id)?.status).toBe('submitted');
  });

  it('records failures without rejecting the caller', async () => {
    const { database, paths, events } = await fixture(
      '  on_review_request: manual\n  on_new_commits: ignore\n  skip_drafts: true',
    );
    const poller = new Poller(
      database,
      {
        searchReviewRequests: async () => {
          throw new Error('GitHub unavailable');
        },
      } as unknown as GhClient,
      { enqueue: vi.fn() } as unknown as ReviewService,
      paths,
      events,
      AppConfigSchema.parse({}),
    );

    await expect(poller.pollNow()).resolves.toBeUndefined();
    expect(poller.getStatus()).toMatchObject({
      state: 'error',
      lastError: 'GitHub unavailable',
    });
    expect(database.listActivities().items[0]).toMatchObject({
      type: 'poll.failed',
    });
  });
});
