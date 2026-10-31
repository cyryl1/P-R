import { InboxItemSchema, type InboxItem } from '@pr-reviewer/shared';
import type { DataPaths } from '../config/index.js';
import { ReviewDatabase } from '../db/index.js';
import type { GhClient } from '../gh/client.js';
import { getRules, hasRules } from '../rules/index.js';

export class InboxService {
  constructor(
    private readonly database: ReviewDatabase,
    private readonly gh: GhClient,
    private readonly paths: DataPaths,
  ) {}

  async list(): Promise<InboxItem[]> {
    let prs = this.database.listInboxPrs();
    if (prs.length === 0) {
      const requested = await this.gh.searchReviewRequests({ teams: false });
      const hydrated = await Promise.all(
        requested.map(async (result) => ({
          repo: result.repository.nameWithOwner,
          pr: await this.gh.getPr(
            result.repository.nameWithOwner,
            result.number,
          ),
        })),
      );
      for (const item of hydrated)
        await this.database.upsertPr(item.repo, item.pr, {
          reviewRequested: true,
        });
      prs = this.database.listInboxPrs();
    }

    return Promise.all(
      prs.map(async (pr) => {
        const latestReview = this.database.getLatestReviewForPr(
          pr.repo,
          pr.number,
        );
        const rulesState = await this.rulesState(pr.repo);
        return InboxItemSchema.parse({
          pr: {
            repo: pr.repo,
            number: pr.number,
            title: pr.title,
            author: pr.author,
            url: pr.url,
            headSha: pr.headSha,
            isDraft: pr.isDraft,
            updatedAt: pr.updatedAt,
          },
          rulesState,
          ...(latestReview ? { latestReview } : {}),
          isStale: Boolean(latestReview && latestReview.headSha !== pr.headSha),
        });
      }),
    );
  }

  private async rulesState(repo: string): Promise<InboxItem['rulesState']> {
    if (!(await hasRules(this.paths, repo))) return 'none';
    const rules = await getRules(this.paths, repo);
    if (!rules.valid || !rules.parsed) return 'invalid';
    return rules.parsed.enabled ? 'ok' : 'disabled';
  }
}
