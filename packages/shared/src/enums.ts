import { z } from 'zod';

export const SeveritySchema = z.enum(['blocker', 'major', 'minor', 'nit']);
export const VerdictSchema = z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);
export const ReviewStatusSchema = z.enum([
  'queued', 'gathering', 'reviewing', 'draft_ready', 'stale', 'publishing',
  'published_pending', 'submitted', 'dismissed', 'failed',
]);
export const ReviewTriggerSchema = z.enum(['auto', 'manual', 'rerun']);
export const DiffSideSchema = z.enum(['RIGHT', 'LEFT']);
export const RuleResultStatusSchema = z.enum(['pass', 'fail', 'na', 'unsure']);
export const RuleKindSchema = z.enum(['deterministic', 'llm']);
export const ErrorCodeSchema = z.enum([
  'GH_NOT_AUTHENTICATED', 'GH_NOT_FOUND', 'GH_RATE_LIMITED', 'LLM_NOT_CONFIGURED',
  'RULES_INVALID', 'NO_RULES', 'INVALID_STATE', 'HEAD_MOVED', 'PENDING_EXISTS',
  'VALIDATION_ERROR', 'INTERNAL',
]);

export type Severity = z.infer<typeof SeveritySchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type ReviewTrigger = z.infer<typeof ReviewTriggerSchema>;
export type DiffSide = z.infer<typeof DiffSideSchema>;
export type RuleResultStatus = z.infer<typeof RuleResultStatusSchema>;
export type RuleKind = z.infer<typeof RuleKindSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
