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
      const [requested, authored, allRequested] = await Promise.all([
        this.gh.searchReviewRequests({ teams: false }),
        this.gh.searchAuthoredPullRequests?.() ?? Promise.resolve([]),
        this.gh.searchReviewRequests({ teams: true }),
      ]);
      const direct = new Set(
        requested.map(
          (item) => `${item.repository.nameWithOwner}#${item.number}`,
        ),
      );
      const discovered = new Map<
        string,
        {
          result: (typeof requested)[number];
          relation: InboxItem['relation'];
        }
      >();
      for (const result of authored)
        discovered.set(`${result.repository.nameWithOwner}#${result.number}`, {
          result,
          relation: 'authored',
        });
      for (const result of allRequested) {
        const key = `${result.repository.nameWithOwner}#${result.number}`;
        if (!direct.has(key))
          discovered.set(key, { result, relation: 'team_review_requested' });
      }
      for (const result of requested)
        discovered.set(`${result.repository.nameWithOwner}#${result.number}`, {
          result,
          relation: 'review_requested',
        });
      const hydrated = await Promise.all(
        [...discovered.values()].map(async ({ result, relation }) => ({
          repo: result.repository.nameWithOwner,
          pr: await this.gh.getPr(
            result.repository.nameWithOwner,
            result.number,
          ),
          relation,
        })),
      );
      for (const item of hydrated)
        await this.database.upsertPr(item.repo, item.pr, {
          reviewRequested: item.relation !== 'authored',
          relation: item.relation,
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
          relation: pr.relation,
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
