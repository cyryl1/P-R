import type { AppConfig } from '@pr-reviewer/shared';
import { ReviewDatabase, type ReviewJob } from '../db/index.js';
import { GhAuthError, GhError, GhNotFoundError } from '../gh/errors.js';
import type { ReviewService } from '../review/index.js';
import { LlmProviderError } from '../llm/provider.js';

export type JobQueueOptions = {
  backoffBaseMs?: number;
};

export class JobQueue {
  private running = new Set<Promise<void>>();
  private timer?: NodeJS.Timeout;
  private pumping = false;
  private started = false;
  private config: AppConfig;
  private readonly backoffBaseMs: number;

  constructor(
    private readonly database: ReviewDatabase,
    private readonly reviews: ReviewService,
    config: AppConfig,
    options: JobQueueOptions = {},
  ) {
    this.config = config;
    this.backoffBaseMs = options.backoffBaseMs ?? 1_000;
  }

  configure(config: AppConfig) {
    this.config = config;
    this.wake();
  }

  async start() {
    if (this.started) return;
    await this.database.recoverJobs();
    this.started = true;
    this.wake();
  }

  async stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    await Promise.allSettled([...this.running]);
  }

  async enqueue(reviewId: string) {
    const job = await this.database.enqueueJob(reviewId);
    this.wake();
    return job;
  }

  private wake() {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.pump(), 0);
    this.timer.unref();
  }

  private async pump() {
    if (!this.started || this.pumping) return;
    this.pumping = true;
    try {
      while (this.started && this.running.size < this.config.jobs.concurrency) {
        const job = await this.database.claimNextJob();
        if (!job) break;
        const task = this.run(job).finally(() => {
          this.running.delete(task);
          this.wake();
        });
        this.running.add(task);
      }
      if (this.running.size === 0) this.scheduleNextAvailable();
    } finally {
      this.pumping = false;
    }
  }

  private scheduleNextAvailable() {
    const availableAt = this.database.nextJobAvailableAt();
    if (!availableAt || !this.started) return;
    const delay = Math.max(0, new Date(availableAt).getTime() - Date.now());
    this.timer = setTimeout(() => void this.pump(), delay);
    this.timer.unref();
  }

  private async run(job: ReviewJob) {
    try {
      await this.reviews.run(job.reviewId);
      await this.database.completeJob(job.id);
      await this.database.addActivity({
        level: 'info',
        type: 'job.completed',
        message: `Review job completed after ${job.attempts} attempt(s)`,
        reviewId: job.reviewId,
        prId: job.prId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Review job failed';
      const canRetry =
        this.isTransient(error) && job.attempts <= this.config.jobs.max_retries;
      if (!canRetry) {
        await this.database.failJob(job.id, message);
        await this.database.addActivity({
          level: 'error',
          type: 'job.failed',
          message,
          reviewId: job.reviewId,
          prId: job.prId,
        });
        return;
      }
      const delay = this.backoffBaseMs * 2 ** Math.max(0, job.attempts - 1);
      await this.database.updateReview(job.reviewId, {
        status: 'queued',
        error: `Retrying after transient failure: ${message}`,
      });
      await this.database.retryJob(
        job.id,
        message,
        new Date(Date.now() + delay),
      );
      await this.database.addActivity({
        level: 'warn',
        type: 'job.retry_scheduled',
        message: `Retry ${job.attempts} scheduled in ${delay}ms: ${message}`,
        reviewId: job.reviewId,
        prId: job.prId,
      });
    }
  }

  private isTransient(error: unknown) {
    if (error instanceof LlmProviderError)
      return (
        error.status === undefined ||
        error.status === 429 ||
        error.status >= 500
      );
    return (
      error instanceof GhError &&
      !(error instanceof GhAuthError) &&
      !(error instanceof GhNotFoundError)
    );
  }
}
