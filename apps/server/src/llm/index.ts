import type { AppConfig } from '@pr-reviewer/shared';
import { MockProvider } from './mock.js';
import { OpenRouterProvider } from './openrouter.js';
import type { ReviewProvider } from './provider.js';

export * from './mock.js';
export * from './openrouter.js';
export * from './provider.js';

export function createReviewProvider(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetch?: typeof globalThis.fetch,
): ReviewProvider {
  if (config.llm.provider === 'mock') return new MockProvider();
  return new OpenRouterProvider({
    ...(env.OPENROUTER_API_KEY ? { apiKey: env.OPENROUTER_API_KEY } : {}),
    model: config.llm.model,
    maxOutputTokens: config.llm.max_output_tokens,
    ...(fetch ? { fetch } : {}),
  });
}
