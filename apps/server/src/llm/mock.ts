import type { ReviewOutput } from '@pr-reviewer/shared';
import type { ProviderReviewResult, ReviewProvider } from './provider.js';

export class MockProvider implements ReviewProvider {
  readonly name = 'mock';
  readonly model = 'mock';

  constructor(
    private readonly output: ReviewOutput = {
      summary: 'Mock review completed.',
      verdict: 'COMMENT',
      comments: [],
      ruleResults: [],
    },
  ) {}

  async review(): Promise<ProviderReviewResult> {
    return {
      output: this.output,
      meta: {
        provider: this.name,
        model: this.model,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      },
    };
  }
}
