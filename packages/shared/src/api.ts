import { z } from 'zod';
import { AppConfigSchema } from './config.js';
import { DiffSideSchema, ErrorCodeSchema, ReviewStatusSchema, ReviewTriggerSchema, RuleKindSchema, RuleResultStatusSchema, SeveritySchema, VerdictSchema } from './enums.js';
import { RulesFileSchema } from './rules.js';

export const RulesErrorSchema = z.object({ path: z.string(), message: z.string(), line: z.number().int().positive().optional(), column: z.number().int().positive().optional() });
export const RuleResultSchema = z.object({ ruleId: z.string(), kind: RuleKindSchema, status: RuleResultStatusSchema, note: z.string(), severity: SeveritySchema });
export const ReviewCommentSchema = z.object({ id: z.string(), path: z.string(), line: z.number().int().positive(), side: DiffSideSchema, severity: SeveritySchema, ruleId: z.string().optional(), body: z.string(), suggestion: z.string().optional(), source: z.enum(['ai', 'user']), included: z.boolean(), anchorStatus: z.enum(['valid', 'invalid']) });
export const ReviewSummarySchema = z.object({ id: z.string(), repo: z.string(), number: z.number().int(), prTitle: z.string(), headSha: z.string(), trigger: ReviewTriggerSchema, status: ReviewStatusSchema, commentCount: z.number().int().nonnegative(), blockerCount: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string(), error: z.string().optional() });
export const ReviewDetailSchema = ReviewSummarySchema.extend({
  pr: z.object({ title: z.string(), body: z.string(), author: z.string(), url: z.string().url(), baseRef: z.string(), headRef: z.string(), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative() }),
  summary: z.string(), verdict: VerdictSchema, ruleResults: z.array(RuleResultSchema), comments: z.array(ReviewCommentSchema),
  llmMeta: z.object({ provider: z.string(), model: z.string(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), durationMs: z.number().nonnegative(), truncation: z.array(z.string()).optional() }).optional(),
  github: z.object({ reviewId: z.string(), url: z.string().url(), publishedAt: z.string() }).optional(),
});
export const InboxItemSchema = z.object({
  pr: z.object({ repo: z.string(), number: z.number().int(), title: z.string(), author: z.string(), url: z.string().url(), headSha: z.string(), isDraft: z.boolean(), updatedAt: z.string() }),
  rulesState: z.enum(['none', 'invalid', 'disabled', 'ok']), latestReview: ReviewSummarySchema.optional(), isStale: z.boolean(),
});
export const ProjectSummarySchema = z.object({ repo: z.string(), enabled: z.boolean(), valid: z.boolean(), ruleCount: z.number().int().nonnegative(), updatedAt: z.string().optional(), errorCount: z.number().int().nonnegative() });
export const ActivityEntrySchema = z.object({ id: z.string(), ts: z.string(), level: z.enum(['info', 'warn', 'error']), type: z.string(), message: z.string(), reviewId: z.string().optional(), prId: z.number().int().optional() });
export const DiffLineSchema = z.object({ kind: z.enum(['add', 'del', 'context']), oldLine: z.number().int().optional(), newLine: z.number().int().optional(), text: z.string() });
export const DiffFileSchema = z.object({ path: z.string(), oldPath: z.string().optional(), status: z.enum(['added', 'modified', 'deleted', 'renamed']), isBinary: z.boolean(), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative(), hunks: z.array(z.object({ header: z.string(), lines: z.array(DiffLineSchema) })) });
export const HealthResponseSchema = z.object({ gh: z.object({ authenticated: z.boolean(), login: z.string().optional(), error: z.string().optional() }), llm: z.object({ configured: z.boolean(), provider: z.enum(['anthropic', 'mock']), model: z.string() }), poller: z.object({ enabled: z.boolean(), lastRunAt: z.string().optional(), nextRunAt: z.string().optional(), lastError: z.string().optional() }), version: z.string() });
export const ApiErrorSchema = z.object({ error: z.object({ code: ErrorCodeSchema, message: z.string(), details: z.unknown().optional() }) });
export const RulesDocumentSchema = z.object({ repo: z.string(), yaml: z.string(), valid: z.boolean(), parsed: RulesFileSchema.optional(), errors: z.array(RulesErrorSchema) });
export const ReviewOutputSchema = z.object({
  summary: z.string().min(1), verdict: VerdictSchema,
  comments: z.array(z.object({ path: z.string(), line: z.number().int().positive(), side: DiffSideSchema, severity: SeveritySchema, ruleId: z.string().optional(), body: z.string().min(1), suggestion: z.string().optional() })),
  ruleResults: z.array(z.object({ ruleId: z.string(), status: z.enum(['pass', 'fail', 'na', 'unsure']), note: z.string() })),
});
export const ApiSchemas = {
  health: { response: HealthResponseSchema }, settings: { response: AppConfigSchema, update: AppConfigSchema.deepPartial() },
  inbox: { response: z.array(InboxItemSchema) }, poll: { response: z.object({ started: z.literal(true) }) },
  projects: {
    response: z.array(ProjectSummarySchema), document: RulesDocumentSchema,
    save: z.object({ yaml: z.string() }), validate: z.object({ yaml: z.string() }),
    validateResponse: z.object({ valid: z.boolean(), errors: z.array(RulesErrorSchema), parsed: RulesFileSchema.optional() }),
    templateQuery: z.object({ repo: z.string() }),
    params: z.object({ owner: z.string(), repo: z.string() }) },
  reviews: { listQuery: z.object({ status: ReviewStatusSchema.optional(), repo: z.string().optional(), limit: z.coerce.number().int().positive().max(100).optional(), cursor: z.string().optional() }), list: z.object({ items: z.array(ReviewSummarySchema), nextCursor: z.string().optional() }), create: z.object({ prUrl: z.string().url() }), summary: ReviewSummarySchema, detail: ReviewDetailSchema, params: z.object({ id: z.string() }), edit: z.object({ summary: z.string().optional(), verdict: VerdictSchema.optional() }),
    diff: z.array(DiffFileSchema), addComment: z.object({ path: z.string(), line: z.number().int().positive(), side: DiffSideSchema, body: z.string().min(1), severity: SeveritySchema }), editComment: z.object({ body: z.string().optional(), severity: SeveritySchema.optional(), included: z.boolean().optional(), suggestion: z.string().nullable().optional() }), commentParams: z.object({ id: z.string(), cid: z.string() }), publish: z.object({ mode: z.enum(['pending', 'submit']), event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).optional(), force: z.boolean().optional(), replacePending: z.boolean().optional() }), publishResponse: z.object({ status: ReviewStatusSchema, githubReviewUrl: z.string().url(), publishedComments: z.number().int().nonnegative(), foldedIntoSummary: z.number().int().nonnegative() }) },
  activity: { query: z.object({ limit: z.coerce.number().int().positive().max(100).optional(), cursor: z.string().optional() }), response: z.object({ items: z.array(ActivityEntrySchema), nextCursor: z.string().optional() }) },
} as const;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type InboxItem = z.infer<typeof InboxItemSchema>;
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;
export type ReviewDetail = z.infer<typeof ReviewDetailSchema>;
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
