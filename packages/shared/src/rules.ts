import { z } from 'zod';
import { SeveritySchema } from './enums.js';

const BaseRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  severity: SeveritySchema,
  enabled: z.boolean().default(true),
});
const LlmRuleSchema = BaseRuleSchema.extend({
  type: z.literal('llm'), description: z.string().min(1), paths: z.array(z.string()).optional(),
});
const RequireTestsRuleSchema = BaseRuleSchema.extend({
  type: z.literal('require_tests'), when_paths: z.array(z.string()).min(1), test_paths: z.array(z.string()).min(1),
});
const MaxChangedLinesRuleSchema = BaseRuleSchema.extend({
  type: z.literal('max_changed_lines'), limit: z.number().int().nonnegative(),
});
const ForbidPathsRuleSchema = BaseRuleSchema.extend({ type: z.literal('forbid_paths'), paths: z.array(z.string()).min(1) });
const RequireDescriptionRuleSchema = BaseRuleSchema.extend({
  type: z.literal('require_description'), min_length: z.number().int().nonnegative(),
});
const RequireLinkedIssueRuleSchema = BaseRuleSchema.extend({ type: z.literal('require_linked_issue') });

export const RuleSchema = z.discriminatedUnion('type', [
  LlmRuleSchema, RequireTestsRuleSchema, MaxChangedLinesRuleSchema,
  ForbidPathsRuleSchema, RequireDescriptionRuleSchema, RequireLinkedIssueRuleSchema,
]);
export const FocusLevelSchema = z.enum(['strict', 'normal', 'light', 'off']);
export const RulesFileSchema = z.object({
  version: z.literal(1),
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  enabled: z.boolean().default(true),
  triggers: z.object({
    on_review_request: z.enum(['auto', 'manual']).default('manual'),
    on_new_commits: z.enum(['auto', 'notify', 'ignore']).default('notify'),
    skip_drafts: z.boolean().default(true),
  }).default({}),
  review: z.object({
    focus: z.object({
      security: FocusLevelSchema.default('normal'), correctness: FocusLevelSchema.default('normal'),
      performance: FocusLevelSchema.default('normal'), readability: FocusLevelSchema.default('normal'),
      style: FocusLevelSchema.default('normal'),
    }).default({}),
    tone: z.string().default(''), max_comments: z.number().int().positive().default(10),
    min_severity: SeveritySchema.default('minor'), ignore_paths: z.array(z.string()).default([]),
    context_files: z.array(z.string()).default([]), instructions: z.string().default(''),
  }).default({}),
  rules: z.array(RuleSchema).default([]),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.rules.forEach((rule, index) => {
    if (seen.has(rule.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rules', index, 'id'], message: `Duplicate rule id: ${rule.id}` });
    seen.add(rule.id);
  });
});

export type Rule = z.infer<typeof RuleSchema>;
export type RulesFile = z.infer<typeof RulesFileSchema>;
