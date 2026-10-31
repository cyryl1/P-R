import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfigSchema, RulesFileSchema } from '@pr-reviewer/shared';
import { ReviewDatabase } from '../db/index.js';
import { GhRateLimitError } from '../gh/errors.js';
import type { GhPr } from '../gh/client.js';
import type { ReviewService } from '../review/index.js';
import { JobQueue } from './index.js';

const pr: GhPr = {
  number: 7,
  title: 'Queued review',
  body: 'Enough context for a review.',
  author: { login: 'octo' },
  url: 'https://github.com/acme/jobs/pull/7',
  baseRefName: 'main',
  headRefName: 'feature',
  headRefOid: 'abc123',
  isDraft: false,
  additions: 1,
  deletions: 0,
  files: [],
  closingIssuesReferences: [],
  state: 'OPEN',
};
const rules = RulesFileSchema.parse({
  version: 1,
  repo: 'acme/jobs',
  enabled: true,
});

const databases: ReviewDatabase[] = [];
const queues: JobQueue[] = [];
afterEach(async () => {
  await Promise.all(queues.splice(0).map((queue) => queue.stop()));
  for (const database of databases.splice(0)) database.close();
});

async function seededReview() {
  const database = await ReviewDatabase.open(':memory:');
  databases.push(database);
  const prId = await database.upsertPr('acme/jobs', pr);
  const review = await database.createReview({
    prId,
    headSha: pr.headRefOid,
    trigger: 'auto',
    rules,
  });
  return { database, prId, review };
}

describe('durable job queue', () => {
  it('runs persisted jobs and records completion', async () => {
    const { database, review } = await seededReview();
    const run = vi.fn(async () => review);
    const queue = new JobQueue(
      database,
      { run } as unknown as ReviewService,
      AppConfigSchema.parse({ jobs: { concurrency: 1 } }),
    );
    queues.push(queue);
    await queue.enqueue(review.id);
    await queue.start();

    await vi.waitFor(() => {
      expect(database.getJobForReview(review.id)?.status).toBe('done');
    });
    expect(run).toHaveBeenCalledWith(review.id);
    expect(database.listActivities().items[0]).toMatchObject({
      type: 'job.completed',
      reviewId: review.id,
    });
  });

  it('retries rate limits with backoff', async () => {
    const { database, review } = await seededReview();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new GhRateLimitError())
      .mockResolvedValue(review);
    const queue = new JobQueue(
      database,
      { run } as unknown as ReviewService,
      AppConfigSchema.parse({ jobs: { max_retries: 2 } }),
      { backoffBaseMs: 1 },
    );
    queues.push(queue);
    await queue.enqueue(review.id);
    await queue.start();

    await vi.waitFor(() => {
      expect(database.getJobForReview(review.id)?.status).toBe('done');
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(
      database
        .listActivities()
        .items.some((entry) => entry.type === 'job.retry_scheduled'),
    ).toBe(true);
  });

  it('recovers running jobs and prevents two active jobs for one PR', async () => {
    const { database, prId, review } = await seededReview();
    await database.enqueueJob(review.id);
    await database.claimNextJob();
    await database.updateReview(review.id, { status: 'reviewing' });
    await expect(database.recoverJobs()).resolves.toBe(1);
    expect(database.getJobForReview(review.id)?.status).toBe('queued');
    expect(database.getReview(review.id)?.status).toBe('queued');

    const second = await database.createReview({
      prId,
      headSha: 'new-head',
      trigger: 'auto',
      rules,
    });
    await expect(database.enqueueJob(second.id)).rejects.toThrow(
      /already active/,
    );
  });
});
