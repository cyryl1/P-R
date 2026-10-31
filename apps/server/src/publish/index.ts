import type { ReviewDetail, Verdict } from '@pr-reviewer/shared';
import { ReviewDatabase } from '../db/index.js';
import { commentableSet, isValidAnchor } from '../diff/index.js';
import type { GhClient, GhReviewPayload } from '../gh/client.js';
import { ReviewNotFoundError, ReviewStateError } from '../review/index.js';

export type PublishInput = {
  mode: 'pending' | 'submit';
  event?: Verdict;
  force?: boolean;
  replacePending?: boolean;
};

export class HeadMovedError extends Error {
  readonly code = 'HEAD_MOVED';

  constructor(
    message: string,
    readonly currentHeadSha: string,
  ) {
    super(message);
  }
}

export class PendingExistsError extends Error {
  readonly code = 'PENDING_EXISTS';

  constructor(
    message: string,
    readonly reviewId: number,
    readonly reviewUrl?: string,
  ) {
    super(message);
  }
}

function commentBody(comment: ReviewDetail['comments'][number]): string {
  if (!comment.suggestion) return comment.body;
  return `${comment.body}\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``;
}

function buildSummary(
  review: ReviewDetail,
  folded: ReviewDetail['comments'],
): string {
  const sections = [review.summary.trim()];
  const failedChecks = review.ruleResults.filter(
    (result) => result.kind === 'deterministic' && result.status === 'fail',
  );
  if (failedChecks.length > 0) {
    sections.push(
      `### Failed checks\n${failedChecks
        .map(
          (result) =>
            `- **${result.ruleId} (${result.severity})**: ${result.note}`,
        )
        .join('\n')}`,
    );
  }
  if (folded.length > 0) {
    sections.push(
      `### Comments without valid diff anchors\n${folded
        .map(
          (comment) =>
            `- **${comment.path}:${comment.line} (${comment.severity})**: ${comment.body}`,
        )
        .join('\n')}`,
    );
  }
  return sections.filter(Boolean).join('\n\n');
}

export class PublishService {
  constructor(
    private readonly database: ReviewDatabase,
    private readonly gh: GhClient,
  ) {}

  async publish(reviewId: string, input: PublishInput) {
    const review = this.database.getReview(reviewId);
    if (!review) throw new ReviewNotFoundError('Review not found');
    if (!['draft_ready', 'stale'].includes(review.status))
      throw new ReviewStateError(`Cannot publish a ${review.status} review`);
    const currentPr = await this.gh.getPr(review.repo, review.number);
    if (
      (review.status === 'stale' || currentPr.headRefOid !== review.headSha) &&
      !input.force
    )
      throw new HeadMovedError(
        'The pull request head changed after this review was generated',
        currentPr.headRefOid,
      );

    const [{ login }, githubReviews] = await Promise.all([
      this.gh.authStatus(),
      this.gh.listReviews(review.repo, review.number),
    ]);
    const pending = githubReviews.find(
      (candidate) =>
        candidate.state.toUpperCase() === 'PENDING' &&
        candidate.user?.login.toLowerCase() === login.toLowerCase(),
    );
    if (pending && !input.replacePending)
      throw new PendingExistsError(
        'You already have a pending review on this pull request',
        pending.id,
        pending.html_url,
      );
    if (pending)
      await this.gh.deletePendingReview(review.repo, review.number, pending.id);

    const anchors = commentableSet(this.database.getDiff(reviewId) ?? []);
    const included = review.comments.filter((comment) => comment.included);
    const valid = included.filter((comment) =>
      isValidAnchor(anchors, comment.path, comment.line, comment.side),
    );
    const folded = included.filter(
      (comment) =>
        !isValidAnchor(anchors, comment.path, comment.line, comment.side),
    );
    const payload: GhReviewPayload = {
      commit_id: currentPr.headRefOid,
      body: buildSummary(review, folded),
      comments: valid.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: comment.side,
        body: commentBody(comment),
      })),
      ...(input.mode === 'submit'
        ? { event: input.event ?? review.verdict }
        : {}),
    };

    await this.database.updateReview(reviewId, {
      status: 'publishing',
      error: null,
    });
    let published;
    try {
      published = await this.gh.createReview(
        review.repo,
        review.number,
        payload,
      );
    } catch (error) {
      await this.database.updateReview(reviewId, {
        status: review.status,
        error: error instanceof Error ? error.message : 'Publishing failed',
      });
      throw error;
    }
    const githubReviewUrl =
      published.html_url ??
      `${review.pr.url}#pullrequestreview-${published.id}`;
    const status = input.mode === 'submit' ? 'submitted' : 'published_pending';
    await this.database.updateReview(reviewId, {
      status,
      githubReviewId: String(published.id),
      githubReviewUrl,
      publishedAt: new Date().toISOString(),
      error: null,
    });
    try {
      await this.database.addActivity({
        level: 'info',
        type: 'review.published',
        message:
          input.mode === 'submit'
            ? `Submitted review for ${review.repo}#${review.number}`
            : `Published pending review for ${review.repo}#${review.number}`,
        reviewId,
      });
    } catch {
      // Publishing succeeded; activity logging must never make a retry duplicate it.
    }
    return {
      status,
      githubReviewUrl,
      publishedComments: valid.length,
      foldedIntoSummary: folded.length,
    } as const;
  }
}
