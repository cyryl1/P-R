import type { AppConfig } from '@pr-reviewer/shared';
import type { DataPaths } from '../config/index.js';
import { ReviewDatabase } from '../db/index.js';
import { EventHub } from '../events/index.js';
import type { GhClient, GhPr } from '../gh/client.js';
import type { ReviewService } from '../review/index.js';
import { getRules, hasRules } from '../rules/index.js';

export type PollStatus = {
  state: 'running' | 'idle' | 'error';
  lastRunAt?: string;
  nextRunAt?: string;
  lastError?: string;
};

type HydratedRequest = { repo: string; pr: GhPr };

export class Poller {
  private config: AppConfig;
  private status: PollStatus = { state: 'idle' };
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> | undefined;
  private started = false;

  constructor(
    private readonly database: ReviewDatabase,
    private readonly gh: GhClient,
    private readonly reviews: ReviewService,
    private readonly paths: DataPaths,
    private readonly events: EventHub,
    config: AppConfig,
  ) {
    this.config = config;
  }

  getStatus(): PollStatus {
    return { ...this.status };
  }

  configure(config: AppConfig) {
    this.config = config;
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    if (config.poller.enabled) this.schedule();
    else {
      this.status = {
        state: 'idle',
        ...(this.status.lastRunAt ? { lastRunAt: this.status.lastRunAt } : {}),
      };
      this.emitStatus();
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (this.config.poller.enabled) void this.pollNow();
  }

  async stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  pollNow(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run()
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = undefined;
        if (this.started && this.config.poller.enabled) this.schedule();
      });
    return this.inFlight;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    const interval = this.config.poller.interval_minutes * 60_000;
    const nextRunAt = new Date(Date.now() + interval).toISOString();
    this.status = { ...this.status, nextRunAt };
    this.emitStatus();
    this.timer = setTimeout(() => void this.pollNow(), interval);
    this.timer.unref();
  }

  private async run() {
    this.status = {
      state: 'running',
      ...(this.status.lastRunAt ? { lastRunAt: this.status.lastRunAt } : {}),
      ...(this.status.nextRunAt ? { nextRunAt: this.status.nextRunAt } : {}),
    };
    this.emitStatus();
    try {
      const results = await this.gh.searchReviewRequests({
        teams: this.config.poller.include_team_requests,
      });
      const hydrated = await Promise.all(
        results.map(async (search): Promise<HydratedRequest> => {
          const repo = search.repository.nameWithOwner;
          return { repo, pr: await this.gh.getPr(repo, search.number) };
        }),
      );
      await this.detectSubmittedReviews();
      await this.database.clearReviewRequests();
      for (const item of hydrated)
        await this.database.upsertPr(item.repo, item.pr, {
          reviewRequested: true,
        });
      for (const item of hydrated) await this.applyTrigger(item);

      const lastRunAt = new Date().toISOString();
      this.status = { state: 'idle', lastRunAt };
      this.events.publish({
        type: 'inbox.updated',
        data: { count: this.database.listInboxPrs().length },
      });
      this.emitStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Polling failed';
      const lastRunAt = new Date().toISOString();
      this.status = { state: 'error', lastRunAt, lastError: message };
      await this.database.addActivity({
        level: 'error',
        type: 'poll.failed',
        message,
      });
      this.emitStatus();
      throw error;
    }
  }

  private async applyTrigger(item: HydratedRequest) {
    if (!(await hasRules(this.paths, item.repo))) return;
    const document = await getRules(this.paths, item.repo);
    const rules = document.parsed;
    if (!document.valid || !rules?.enabled) return;
    if (rules.triggers.skip_drafts && item.pr.isDraft) return;

    const forHead = this.database.getReviewForHead(
      item.repo,
      item.pr.number,
      item.pr.headRefOid,
    );
    if (forHead) return;
    const latest = this.database.getLatestReviewForPr(
      item.repo,
      item.pr.number,
    );
    if (!latest) {
      if (rules.triggers.on_review_request === 'auto')
        await this.enqueueAutomatic(item);
      return;
    }

    if (rules.triggers.on_new_commits === 'auto') {
      await this.enqueueAutomatic(item);
      return;
    }
    if (
      rules.triggers.on_new_commits === 'notify' &&
      latest.status === 'draft_ready'
    ) {
      await this.database.updateReview(latest.id, {
        status: 'stale',
        error: 'New commits were detected on the pull request.',
      });
      await this.database.addActivity({
        level: 'warn',
        type: 'review.stale',
        message: `${item.repo}#${item.pr.number} has new commits`,
        reviewId: latest.id,
      });
    }
  }

  private async enqueueAutomatic(item: HydratedRequest) {
    if (this.database.hasActiveJobForPr(item.repo, item.pr.number)) return;
    const review = await this.reviews.enqueue(item.pr.url, 'auto');
    await this.database.addActivity({
      level: 'info',
      type: 'review.auto_queued',
      message: `Automatically queued ${item.repo}#${item.pr.number}`,
      reviewId: review.id,
    });
  }

  private async detectSubmittedReviews() {
    const pending = this.database.listReviews({
      status: 'published_pending',
      limit: 100,
    }).items;
    for (const summary of pending) {
      const review = this.database.getReview(summary.id);
      if (!review?.github) continue;
      const githubReviews = await this.gh.listReviews(
        summary.repo,
        summary.number,
      );
      const match = githubReviews.find(
        (candidate) => String(candidate.id) === review.github?.reviewId,
      );
      if (
        !match ||
        !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(
          match.state.toUpperCase(),
        )
      )
        continue;
      await this.database.updateReview(summary.id, { status: 'submitted' });
      await this.database.addActivity({
        level: 'info',
        type: 'review.submitted',
        message: `Review for ${summary.repo}#${summary.number} was submitted on GitHub`,
        reviewId: summary.id,
      });
    }
  }

  private emitStatus() {
    this.events.publish({
      type: 'poll.status',
      data: {
        state: this.status.state,
        ...(this.status.lastRunAt ? { lastRunAt: this.status.lastRunAt } : {}),
        ...(this.status.nextRunAt ? { nextRunAt: this.status.nextRunAt } : {}),
        ...(this.status.lastError ? { error: this.status.lastError } : {}),
      },
    });
  }
}
