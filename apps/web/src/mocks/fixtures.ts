import {
  ErrorCodeSchema,
  ReviewStatusSchema,
  type ActivityEntry,
  type AppConfig,
  type ErrorCode,
  type HealthResponse,
  type InboxItem,
  type ReviewComment,
  type RulesFile,
  type ReviewDetail,
  type ReviewStatus,
  type ReviewSummary,
} from '@pr-reviewer/shared';
import type { DiffFile, ProjectSummary, RulesDocument } from '@/api/types';

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const ahead = (minutes: number) =>
  new Date(NOW + minutes * 60_000).toISOString();

export const healthOk: HealthResponse = {
  gh: { authenticated: true, login: 'cyryl1' },
  llm: { configured: true, provider: 'anthropic', model: 'claude-sonnet-5-5' },
  poller: { enabled: true, lastRunAt: ago(2), nextRunAt: ahead(3) },
  version: '0.1.0',
};
export const healthGhLoggedOut: HealthResponse = {
  ...healthOk,
  gh: { authenticated: false, error: 'not logged in' },
};
export const healthNoKey: HealthResponse = {
  ...healthOk,
  llm: { configured: false, provider: 'mock', model: 'mock' },
};

export const settings: AppConfig = {
  server: { port: 4317 },
  poller: { enabled: true, interval_minutes: 5, include_team_requests: false },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    max_input_tokens: 120000,
    max_output_tokens: 8000,
  },
  jobs: { concurrency: 1, max_retries: 2 },
};

export function reviewSummary(
  status: ReviewStatus,
  overrides: Partial<ReviewSummary> = {},
): ReviewSummary {
  const failed = status === 'failed';
  return {
    id: `rev_${status}`,
    repo: 'acme/payments-api',
    number: 128,
    prTitle: 'Add refund endpoint',
    headSha: 'a1b2c3d4e5f6',
    trigger: 'auto',
    status,
    commentCount:
      failed || ['queued', 'gathering', 'reviewing'].includes(status) ? 0 : 3,
    blockerCount:
      failed || ['queued', 'gathering', 'reviewing'].includes(status) ? 0 : 1,
    createdAt: ago(30),
    updatedAt: ago(5),
    ...(failed
      ? { error: 'LLM output failed validation after one retry' }
      : {}),
    ...overrides,
  };
}

/** One summary for every review status. */
export const reviewSummaries: ReviewSummary[] = ReviewStatusSchema.options.map(
  (status) => reviewSummary(status),
);

export const comments: ReviewComment[] = [
  {
    id: 'c1',
    path: 'src/routes/refunds.ts',
    line: 12,
    side: 'RIGHT',
    severity: 'blocker',
    ruleId: 'auth-on-endpoints',
    body: 'This endpoint is missing `requireAuth`.',
    suggestion: "router.post('/refunds', requireAuth, createRefund);",
    source: 'ai',
    included: true,
    anchorStatus: 'valid',
  },
  {
    id: 'c2',
    path: 'src/routes/refunds.ts',
    line: 20,
    side: 'RIGHT',
    severity: 'minor',
    body: 'Amount should be integer minor units.',
    source: 'ai',
    included: true,
    anchorStatus: 'valid',
  },
  {
    id: 'c3',
    path: 'src/services/refunds.ts',
    line: 8,
    side: 'LEFT',
    severity: 'nit',
    body: 'Consider keeping the old name for grep-ability.',
    source: 'user',
    included: false,
    anchorStatus: 'valid',
  },
  {
    id: 'c4',
    path: 'src/legacy/old.ts',
    line: 400,
    side: 'RIGHT',
    severity: 'major',
    body: 'This line is outside the diff, so it is unanchored.',
    source: 'ai',
    included: true,
    anchorStatus: 'invalid',
  },
];

export function reviewDetail(status: ReviewStatus): ReviewDetail {
  const summary = reviewSummary(status);
  const hasDraft = !['queued', 'gathering', 'reviewing', 'failed'].includes(
    status,
  );
  return {
    ...summary,
    pr: {
      title: summary.prTitle,
      body: 'Adds POST /refunds.',
      author: 'octocat',
      url: 'https://github.com/acme/payments-api/pull/128',
      baseRef: 'main',
      headRef: 'feat/refunds',
      additions: 120,
      deletions: 14,
    },
    summary: hasDraft
      ? 'Refund endpoint works but is missing auth and uses floats for money.'
      : '',
    verdict: 'REQUEST_CHANGES',
    ruleResults: hasDraft
      ? [
          {
            ruleId: 'auth-on-endpoints',
            kind: 'llm',
            status: 'fail',
            note: 'POST /refunds has no requireAuth',
            severity: 'blocker',
          },
          {
            ruleId: 'pr-size',
            kind: 'deterministic',
            status: 'pass',
            note: '134 changed lines (limit 600)',
            severity: 'minor',
          },
          {
            ruleId: 'tests-for-logic',
            kind: 'deterministic',
            status: 'fail',
            note: 'No test files changed',
            severity: 'major',
          },
          {
            ruleId: 'has-description',
            kind: 'deterministic',
            status: 'na',
            note: '',
            severity: 'minor',
          },
          {
            ruleId: 'money-minor-units',
            kind: 'llm',
            status: 'unsure',
            note: 'Could not tell from the diff',
            severity: 'major',
          },
        ]
      : [],
    comments: hasDraft ? comments : [],
    ...(hasDraft
      ? {
          llmMeta: {
            provider: 'anthropic',
            model: 'claude-sonnet-5-5',
            inputTokens: 18200,
            outputTokens: 640,
            durationMs: 9400,
            truncation: [
              'Dropped yarn.lock',
              'Truncated src/big.ts by 340 lines',
            ],
          },
        }
      : {}),
    ...(status === 'published_pending' || status === 'submitted'
      ? {
          github: {
            reviewId: '987654',
            url: 'https://github.com/acme/payments-api/pull/128#pullrequestreview-987654',
            publishedAt: ago(2),
          },
        }
      : {}),
  };
}

export const diffFiles: DiffFile[] = [
  {
    path: 'src/routes/refunds.ts',
    status: 'modified',
    isBinary: false,
    additions: 3,
    deletions: 1,
    hunks: [
      {
        header: '@@ -9,4 +9,6 @@',
        lines: [
          {
            kind: 'context',
            oldLine: 9,
            newLine: 9,
            text: "import { router } from './router';",
          },
          {
            kind: 'del',
            oldLine: 10,
            text: "router.post('/refunds', legacyHandler);",
          },
          {
            kind: 'add',
            newLine: 10,
            text: "router.post('/refunds', createRefund);",
          },
          { kind: 'add', newLine: 11, text: '' },
          { kind: 'add', newLine: 12, text: 'export const amount = 12.5;' },
          {
            kind: 'context',
            oldLine: 11,
            newLine: 13,
            text: 'export default router;',
          },
        ],
      },
    ],
  },
  {
    path: 'assets/logo.png',
    status: 'added',
    isBinary: true,
    additions: 0,
    deletions: 0,
    hunks: [],
  },
  {
    path: 'yarn.lock',
    status: 'modified',
    isBinary: false,
    additions: 2,
    deletions: 2,
    hunks: [],
  },
];

export const projects: ProjectSummary[] = [
  {
    repo: 'acme/payments-api',
    enabled: true,
    valid: true,
    ruleCount: 6,
    updatedAt: ago(600),
    errorCount: 0,
  },
  {
    repo: 'acme/web',
    enabled: true,
    valid: false,
    ruleCount: 0,
    updatedAt: ago(1500),
    errorCount: 2,
  },
  {
    repo: 'acme/legacy',
    enabled: false,
    valid: true,
    ruleCount: 2,
    updatedAt: ago(9000),
    errorCount: 0,
  },
];

export const validYaml =
  'version: 1\nrepo: acme/payments-api\nenabled: true\nrules: []\n';
export const invalidYaml =
  'version: 1\nrepo: acme/web\nrules:\n  - id: pr-size\n    type: max_changed_lines\n    limit: lots\n    severity: minor\n';

export function parsedRules(repo: string): RulesFile {
  return {
    version: 1,
    repo,
    enabled: true,
    triggers: {
      on_review_request: 'auto',
      on_new_commits: 'notify',
      skip_drafts: true,
    },
    review: {
      focus: {
        security: 'strict',
        correctness: 'strict',
        performance: 'normal',
        readability: 'light',
        style: 'off',
      },
      tone: 'Concise.',
      max_comments: 10,
      min_severity: 'minor',
      ignore_paths: [],
      context_files: [],
      instructions: '',
    },
    rules: [
      {
        id: 'auth-on-endpoints',
        type: 'llm',
        description: 'Endpoints use requireAuth',
        severity: 'blocker',
        enabled: true,
      },
      {
        id: 'pr-size',
        type: 'max_changed_lines',
        limit: 600,
        severity: 'minor',
        enabled: true,
      },
    ],
  };
}

export function projectDocument(repo: string): RulesDocument {
  const bad = repo === 'acme/web';
  return bad
    ? {
        repo,
        yaml: invalidYaml,
        valid: false,
        errors: [
          {
            path: 'rules[0].limit',
            message: 'expected number',
            line: 6,
            column: 12,
          },
        ],
      }
    : {
        repo,
        yaml: validYaml.replace('acme/payments-api', repo),
        valid: true,
        parsed: parsedRules(repo),
        errors: [],
      };
}

const prBase = {
  author: 'octocat',
  headSha: 'a1b2c3d4e5f6',
  isDraft: false,
  updatedAt: ago(20),
};
const pr = (
  n: number,
  repo: string,
  title: string,
  extra: Partial<InboxItem['pr']> = {},
): InboxItem['pr'] => ({
  repo,
  number: n,
  title,
  url: `https://github.com/${repo}/pull/${n}`,
  ...prBase,
  ...extra,
});

/** Inbox rows covering every rulesState and the stale / draft / failed variants. */
export const inbox: InboxItem[] = [
  {
    pr: pr(128, 'acme/payments-api', 'Add refund endpoint'),
    rulesState: 'ok',
    latestReview: reviewSummary('draft_ready'),
    isStale: false,
  },
  {
    pr: pr(129, 'acme/payments-api', 'Fix rounding in invoices', {
      headSha: 'ffff0000aaaa',
    }),
    rulesState: 'ok',
    latestReview: reviewSummary('stale', { number: 129 }),
    isStale: true,
  },
  {
    pr: pr(130, 'acme/payments-api', 'Bump deps'),
    rulesState: 'ok',
    isStale: false,
  },
  {
    pr: pr(55, 'acme/web', 'Redesign settings page'),
    rulesState: 'invalid',
    isStale: false,
  },
  {
    pr: pr(9, 'acme/tools', 'Add CLI flag'),
    rulesState: 'none',
    isStale: false,
  },
  {
    pr: pr(3, 'acme/legacy', 'Remove dead code'),
    rulesState: 'disabled',
    isStale: false,
  },
  {
    pr: pr(131, 'acme/payments-api', 'WIP: webhooks', { isDraft: true }),
    rulesState: 'ok',
    latestReview: reviewSummary('failed', { number: 131 }),
    isStale: false,
  },
  {
    pr: pr(132, 'acme/payments-api', 'Publish test'),
    rulesState: 'ok',
    latestReview: reviewSummary('published_pending', { number: 132 }),
    isStale: false,
  },
];

export const activity: ActivityEntry[] = [
  {
    id: 'a1',
    ts: ago(2),
    level: 'info',
    type: 'poll.completed',
    message: 'Polled GitHub: 8 PRs requesting review',
  },
  {
    id: 'a2',
    ts: ago(30),
    level: 'warn',
    type: 'review.stale',
    message: 'acme/payments-api#129 has new commits',
    reviewId: 'rev_stale',
  },
  {
    id: 'a3',
    ts: ago(45),
    level: 'error',
    type: 'review.failed',
    message: 'acme/payments-api#131: LLM output failed validation',
    reviewId: 'rev_failed',
  },
];

/** Error response bodies keyed by every error code, with the HTTP status the backend uses. */
export const errorResponses: Record<
  ErrorCode,
  { status: number; message: string; details?: unknown }
> = {
  GH_NOT_AUTHENTICATED: {
    status: 401,
    message: '`gh` is not logged in. Run `gh auth login`.',
  },
  GH_NOT_FOUND: { status: 404, message: 'GitHub could not find that PR.' },
  GH_RATE_LIMITED: {
    status: 429,
    message: 'GitHub rate limit reached. Try again shortly.',
  },
  LLM_NOT_CONFIGURED: { status: 503, message: 'ANTHROPIC_API_KEY is not set.' },
  RULES_INVALID: {
    status: 422,
    message: 'The rules file is invalid.',
    details: {
      errors: [{ path: 'rules[0].limit', message: 'expected number', line: 6 }],
    },
  },
  NO_RULES: { status: 404, message: 'No rules file exists for this repo.' },
  INVALID_STATE: {
    status: 409,
    message: 'The review is not editable in its current state.',
  },
  HEAD_MOVED: {
    status: 409,
    message: 'The author pushed new commits since this review.',
  },
  PENDING_EXISTS: {
    status: 409,
    message: 'You already have a pending review on this PR.',
    details: { reviewId: '987654' },
  },
  VALIDATION_ERROR: { status: 400, message: 'Invalid request.' },
  INTERNAL: { status: 500, message: 'Something went wrong on the server.' },
};

export const errorCodes = ErrorCodeSchema.options;
