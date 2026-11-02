import type { ReviewOutput } from '@pr-reviewer/shared';
import type {
  ProviderGenerationResult,
  ProviderReviewResult,
  ReviewProvider,
  StructuredGenerationInput,
} from './provider.js';

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

  async review(input: Parameters<ReviewProvider['review']>[0]): Promise<ProviderReviewResult> {
    const output =
      this.output.comments.length > 0 || !input.mockAnchors?.length
        ? this.output
        : {
            ...this.output,
            comments: input.mockAnchors.slice(0, 3).map((anchor) => ({
              ...anchor,
              severity: 'minor' as const,
              body: `Mock review comment for ${anchor.path}:${anchor.line}.`,
            })),
          };
    return {
      output,
      meta: {
        provider: this.name,
        model: this.model,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      },
    };
  }

  async generateStructured(
    input: StructuredGenerationInput,
  ): Promise<ProviderGenerationResult> {
    return {
      content: input.mockContent ?? '{}',
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
