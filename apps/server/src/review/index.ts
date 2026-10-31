import type {
  AppConfig,
  ReviewComment,
  ReviewDetail,
  ReviewStatus,
  ReviewSummary,
  ReviewTrigger,
  RuleResultStatus,
  Severity,
} from '@pr-reviewer/shared';
import { runDeterministicChecks } from '../checks/index.js';
import type { DataPaths } from '../config/index.js';
import { gatherContext } from '../context/index.js';
import { ReviewDatabase } from '../db/index.js';
import { commentableSet, isValidAnchor, type DiffFile } from '../diff/index.js';
import type { GhClient } from '../gh/client.js';
import type { ReviewProvider } from '../llm/provider.js';
import { buildReviewPrompt } from '../llm/prompt.js';
import { getRules } from '../rules/index.js';

const editableStatuses = new Set<ReviewStatus>(['draft_ready', 'stale']);
const rerunnableStatuses = new Set<ReviewStatus>([
  'draft_ready',
  'stale',
  'failed',
  'dismissed',
]);
const severityRank: Record<Severity, number> = {
  nit: 0,
  minor: 1,
  major: 2,
  blocker: 3,
};
const FREE_MODEL_INPUT_TOKENS = 24_000;
const FREE_MODEL_OUTPUT_TOKENS = 4_000;

export function reviewTokenBudgets(
  config: AppConfig,
  provider: Pick<ReviewProvider, 'name' | 'model'>,
) {
  const isFreeOpenRouterModel =
    provider.name === 'openrouter' && provider.model.endsWith(':free');
  return {
    inputTokens: isFreeOpenRouterModel
      ? Math.min(config.llm.max_input_tokens, FREE_MODEL_INPUT_TOKENS)
      : config.llm.max_input_tokens,
    outputTokens: isFreeOpenRouterModel
      ? Math.min(config.llm.max_output_tokens, FREE_MODEL_OUTPUT_TOKENS)
      : config.llm.max_output_tokens,
    cappedForFreeModel: isFreeOpenRouterModel,
  };
}

export class ReviewStateError extends Error {
  readonly code = 'INVALID_STATE';
}

export class ReviewNotFoundError extends Error {}

export function parsePullRequestUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PR URL must be an absolute GitHub URL');
  }
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()))
    throw new Error('Only github.com pull request URLs are supported');
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
  if (!match)
    throw new Error(
      'PR URL must look like https://github.com/owner/repo/pull/123',
    );
  return {
    repo: `${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}`,
    number: Number(match[3]),
  };
}

export class ReviewService {
  constructor(
    readonly database: ReviewDatabase,
    private readonly gh: GhClient,
    private readonly provider: ReviewProvider,
    private readonly paths: DataPaths,
    private readonly config: AppConfig,
  ) {}

  async create(prUrl: string, trigger: ReviewTrigger = 'manual') {
    const queued = await this.createQueued(prUrl, trigger);
    return this.run(queued.id);
  }

  async enqueue(prUrl: string, trigger: ReviewTrigger = 'manual') {
    const queued = await this.createQueued(prUrl, trigger);
    setImmediate(() => {
      void this.run(queued.id).catch(() => undefined);
    });
    return queued;
  }

  private async createQueued(prUrl: string, trigger: ReviewTrigger) {
    const { repo, number } = parsePullRequestUrl(prUrl);
    const [pr, rulesDocument] = await Promise.all([
      this.gh.getPr(repo, number),
      getRules(this.paths, repo),
    ]);
    if (!rulesDocument.valid || !rulesDocument.parsed)
      throw new Error(`Rules for ${repo} are invalid`);
    if (!rulesDocument.parsed.enabled)
      throw new Error(`Rules for ${repo} are disabled`);
    const prId = await this.database.upsertPr(repo, pr);
    return this.database.createReview({
      prId,
      headSha: pr.headRefOid,
      trigger,
      rules: rulesDocument.parsed,
    });
  }

  async run(reviewId: string): Promise<ReviewSummary> {
    const existing = this.requireReview(reviewId);
    try {
      await this.database.updateReview(reviewId, {
        status: 'gathering',
        error: null,
      });
      const context = await gatherContext(
        this.gh,
        this.paths,
        existing.repo,
        existing.number,
      );
      await this.database.upsertPr(existing.repo, context.pr);
      await this.database.updateReview(reviewId, {
        status: 'reviewing',
        diff: context.files,
      });
      const deterministicResults = runDeterministicChecks({
        pr: context.pr,
        files: context.files,
        rules: context.rulesForRepo,
      });
      const budgets = reviewTokenBudgets(this.config, this.provider);
      const built = buildReviewPrompt({
        pr: context.pr,
        rules: context.rulesForRepo,
        files: context.promptFiles,
        contextFiles: context.contextFiles,
        deterministicResults,
        maxInputTokens: budgets.inputTokens,
      });
      if (
        budgets.cappedForFreeModel &&
        this.config.llm.max_input_tokens > budgets.inputTokens
      )
        built.truncation.unshift(
          `Capped free-model input at an estimated ${budgets.inputTokens} tokens for latency and reliability`,
        );
      const mockAnchors: Array<{
        path: string;
        line: number;
        side: 'RIGHT' | 'LEFT';
      }> = [];
      for (const file of built.files) {
        for (const hunk of file.hunks) {
          for (const line of hunk.lines) {
            if (line.kind === 'add' && line.newLine !== undefined)
              mockAnchors.push({ path: file.path, line: line.newLine, side: 'RIGHT' });
            if (line.kind === 'del' && line.oldLine !== undefined)
              mockAnchors.push({ path: file.path, line: line.oldLine, side: 'LEFT' });
          }
        }
      }
      const providerResult = await this.provider.review({
        system: built.system,
        prompt: built.prompt,
        maxOutputTokens: budgets.outputTokens,
        mockAnchors,
      });
      const minimum = severityRank[context.rulesForRepo.review.min_severity];
      const anchors = commentableSet(context.files);
      const comments = providerResult.output.comments
        .filter((comment) => severityRank[comment.severity] >= minimum)
        .sort(
          (left, right) =>
            severityRank[right.severity] - severityRank[left.severity],
        )
        .slice(0, context.rulesForRepo.review.max_comments)
        .map((comment) => ({
          ...comment,
          source: 'ai' as const,
          included: true,
          anchorStatus: isValidAnchor(
            anchors,
            comment.path,
            comment.line,
            comment.side,
          )
            ? ('valid' as const)
            : ('invalid' as const),
        }));

      const llmResults = new Map(
        providerResult.output.ruleResults.map((item) => [item.ruleId, item]),
      );
      const ruleResults = [
        ...deterministicResults,
        ...context.rulesForRepo.rules
          .filter((rule) => rule.enabled !== false && rule.type === 'llm')
          .map((rule) => {
            const reported = llmResults.get(rule.id);
            return {
              ruleId: rule.id,
              kind: 'llm' as const,
              status: (reported?.status ?? 'unsure') as RuleResultStatus,
              note: reported?.note ?? 'The model did not report a result for this rule.',
              severity: rule.severity,
            };
          }),
      ];
      const truncation = [...context.warnings, ...built.truncation];
      const summary = truncation.length
        ? `${providerResult.output.summary}\n\n> Review scope note: ${truncation.join('; ')}.`
        : providerResult.output.summary;
      await this.database.replaceComments(reviewId, comments);
      await this.database.updateReview(reviewId, {
        status: 'draft_ready',
        summary,
        verdict: providerResult.output.verdict,
        ruleResults,
        llmMeta: {
          ...providerResult.meta,
          ...(truncation.length > 0 ? { truncation } : {}),
        },
        diff: context.files,
        error: null,
      });
    } catch (error) {
      await this.database.updateReview(reviewId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Review failed',
      });
      throw error;
    }
    return this.database.getSummary(reviewId)!;
  }

  get(id: string) {
    return this.requireReview(id);
  }

  getDiff(id: string): DiffFile[] {
    this.requireReview(id);
    return this.database.getDiff(id) ?? [];
  }

  list(options: Parameters<ReviewDatabase['listReviews']>[0]) {
    return this.database.listReviews(options);
  }

  async edit(id: string, patch: { summary?: string; verdict?: ReviewDetail['verdict'] }) {
    const review = this.requireEditable(id);
    return this.database.updateReview(review.id, patch);
  }

  async addComment(
    id: string,
    input: Pick<ReviewComment, 'path' | 'line' | 'side' | 'body' | 'severity'>,
  ) {
    this.requireEditable(id);
    const anchors = commentableSet(this.getDiff(id));
    return this.database.addComment(id, {
      ...input,
      source: 'user',
      included: true,
      anchorStatus: isValidAnchor(anchors, input.path, input.line, input.side)
        ? 'valid'
        : 'invalid',
    });
  }

  async editComment(
    id: string,
    commentId: string,
    patch: Parameters<ReviewDatabase['editComment']>[2],
  ) {
    this.requireEditable(id);
    const comment = await this.database.editComment(id, commentId, patch);
    if (!comment) throw new ReviewNotFoundError('Comment not found');
    return comment;
  }

  async deleteComment(id: string, commentId: string) {
    this.requireEditable(id);
    if (!(await this.database.deleteComment(id, commentId)))
      throw new ReviewNotFoundError('Comment not found');
  }

  async rerun(id: string) {
    const review = this.requireReview(id);
    if (!rerunnableStatuses.has(review.status))
      throw new ReviewStateError(`Cannot rerun a ${review.status} review`);
    return this.enqueue(review.pr.url, 'rerun');
  }

  async dismiss(id: string) {
    const review = this.requireEditable(id);
    return this.database.updateReview(review.id, { status: 'dismissed' });
  }

  private requireReview(id: string) {
    const review = this.database.getReview(id);
    if (!review) throw new ReviewNotFoundError('Review not found');
    return review;
  }

  private requireEditable(id: string) {
    const review = this.requireReview(id);
    if (!editableStatuses.has(review.status))
      throw new ReviewStateError(`Cannot edit a ${review.status} review`);
    return review;
  }
}
