import { z } from 'zod';
import { ActivityEntrySchema, ReviewSummarySchema } from './api.js';

export const ServerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('review.updated'), data: ReviewSummarySchema }),
  z.object({ type: z.literal('inbox.updated'), data: z.object({ count: z.number().int().nonnegative() }) }),
  z.object({ type: z.literal('poll.status'), data: z.object({ state: z.enum(['running', 'idle', 'error']), lastRunAt: z.string().optional(), nextRunAt: z.string().optional(), error: z.string().optional() }) }),
  z.object({ type: z.literal('activity.created'), data: ActivityEntrySchema }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
