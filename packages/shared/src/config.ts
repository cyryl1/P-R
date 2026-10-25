import { z } from 'zod';

export const AppConfigSchema = z.object({
  server: z.object({ port: z.number().int().min(1).max(65535).default(4317) }).default({}),
  poller: z.object({ enabled: z.boolean().default(true), interval_minutes: z.number().int().positive().default(5), include_team_requests: z.boolean().default(false) }).default({}),
  llm: z.object({ provider: z.enum(['anthropic', 'mock']).default('anthropic'), model: z.string().default('claude-sonnet-5-5'), max_input_tokens: z.number().int().positive().default(120000), max_output_tokens: z.number().int().positive().default(8000) }).default({}),
  jobs: z.object({ concurrency: z.number().int().positive().default(1), max_retries: z.number().int().nonnegative().default(2) }).default({}),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
