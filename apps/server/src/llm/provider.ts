import type { ReviewOutput } from '@pr-reviewer/shared';

export type ReviewInput = {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
};

export type ProviderMeta = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export type ProviderReviewResult = {
  output: ReviewOutput;
  meta: ProviderMeta;
};

export interface ReviewProvider {
  readonly name: string;
  readonly model: string;
  review(input: ReviewInput): Promise<ProviderReviewResult>;
}

export class LlmNotConfiguredError extends Error {
  readonly code = 'LLM_NOT_CONFIGURED';

  constructor(provider: string) {
    super(`${provider} is not configured`);
    this.name = 'LlmNotConfiguredError';
  }
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfter?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LlmProviderError';
  }
}
