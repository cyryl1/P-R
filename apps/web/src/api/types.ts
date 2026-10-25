// Types derived from the shared Zod schemas; never hand-write API shapes here.
import type { z } from 'zod';
import type { ApiSchemas, DiffFileSchema, ProjectSummarySchema, RulesDocumentSchema, RulesErrorSchema } from '@pr-reviewer/shared';

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type RulesDocument = z.infer<typeof RulesDocumentSchema>;
export type RulesError = z.infer<typeof RulesErrorSchema>;
export type DiffFile = z.infer<typeof DiffFileSchema>;
export type SettingsUpdate = z.infer<typeof ApiSchemas.settings.update>;
export type ReviewListQuery = z.infer<typeof ApiSchemas.reviews.listQuery>;
export type ReviewList = z.infer<typeof ApiSchemas.reviews.list>;
export type AddCommentBody = z.infer<typeof ApiSchemas.reviews.addComment>;
export type EditCommentBody = z.infer<typeof ApiSchemas.reviews.editComment>;
export type EditReviewBody = z.infer<typeof ApiSchemas.reviews.edit>;
export type PublishBody = z.infer<typeof ApiSchemas.reviews.publish>;
export type PublishResponse = z.infer<typeof ApiSchemas.reviews.publishResponse>;
export type ActivityList = z.infer<typeof ApiSchemas.activity.response>;
