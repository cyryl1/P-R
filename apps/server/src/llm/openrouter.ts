import {
  DEFAULT_OPENROUTER_MODEL,
  ReviewOutputJsonSchema,
  ReviewOutputSchema,
  type ReviewOutput,
} from '@pr-reviewer/shared';
import {
  LlmNotConfiguredError,
  LlmProviderError,
  type ProviderMeta,
  type ProviderReviewResult,
  type ReviewInput,
  type ReviewProvider,
} from './provider.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

type Fetch = typeof globalThis.fetch;
type OpenRouterResponse = {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export type OpenRouterProviderOptions = {
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  fetch?: Fetch;
  appUrl?: string;
  appName?: string;
  timeoutMs?: number;
};

function strictReviewSchema(): Record<string, unknown> {
  const schema = ReviewOutputJsonSchema as Record<string, unknown>;
  const definitions = schema.definitions as Record<string, unknown> | undefined;
  const reviewOutput = definitions?.ReviewOutput;
  if (!reviewOutput || typeof reviewOutput !== 'object') {
    throw new Error('ReviewOutput JSON Schema is missing its root definition');
  }
  return reviewOutput as Record<string, unknown>;
}

function validationMessage(error: unknown): string {
  if (error instanceof SyntaxError)
    return `The response was not valid JSON: ${error.message}`;
  if (error instanceof Error) return error.message;
  return 'The response did not match the required review schema';
}

function parseOutput(content: string): ReviewOutput {
  const parsed: unknown = JSON.parse(content);
  return ReviewOutputSchema.parse(parsed);
}

export class OpenRouterProvider implements ReviewProvider {
  readonly name = 'openrouter';
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly maxOutputTokens: number;
  private readonly fetch: Fetch;
  private readonly appUrl: string | undefined;
  private readonly appName: string;
  private readonly timeoutMs: number;

  constructor(options: OpenRouterProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_OPENROUTER_MODEL;
    this.maxOutputTokens = options.maxOutputTokens ?? 8000;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.appUrl = options.appUrl;
    this.appName = options.appName ?? 'PR Reviewer';
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async review(input: ReviewInput): Promise<ProviderReviewResult> {
    if (!this.apiKey) throw new LlmNotConfiguredError('OpenRouter');

    const startedAt = performance.now();
    let validationFeedback: string | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.request(input, validationFeedback);
      const content = response.body.choices?.[0]?.message?.content;
      const refusal = response.body.choices?.[0]?.message?.refusal;
      if (refusal)
        throw new LlmProviderError(`OpenRouter refused the review: ${refusal}`);
      if (!content)
        throw new LlmProviderError('OpenRouter returned no review content');

      try {
        const output = parseOutput(content);
        return {
          output,
          meta: this.meta(response.body, startedAt),
        };
      } catch (error) {
        validationFeedback = validationMessage(error);
        if (attempt === 1) {
          throw new LlmProviderError(
            `OpenRouter returned invalid structured output after one retry: ${validationFeedback}`,
            undefined,
            undefined,
            { cause: error },
          );
        }
      }
    }

    throw new LlmProviderError('OpenRouter review failed');
  }

  private async request(input: ReviewInput, validationFeedback?: string) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': this.appName,
    };
    if (this.appUrl) headers['HTTP-Referer'] = this.appUrl;

    const messages = [
      { role: 'system', content: input.system },
      { role: 'user', content: input.prompt },
      ...(validationFeedback
        ? [
            {
              role: 'user',
              content: `Your previous response was invalid: ${validationFeedback}. Return only a corrected response matching the JSON schema.`,
            },
          ]
        : []),
    ];

    let response: Response;
    try {
      response = await this.fetch(OPENROUTER_URL, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: input.maxOutputTokens ?? this.maxOutputTokens,
          temperature: 0,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'review_output',
              strict: true,
              schema: strictReviewSchema(),
            },
          },
          provider: { require_parameters: true },
        }),
      });
    } catch (error) {
      throw new LlmProviderError(
        'Could not reach OpenRouter',
        undefined,
        undefined,
        { cause: error },
      );
    }

    const body = await this.readBody(response);
    if (!response.ok) {
      const message =
        body.error?.message ??
        `OpenRouter request failed with HTTP ${response.status}`;
      throw new LlmProviderError(
        message,
        response.status,
        response.headers.get('retry-after') ?? undefined,
      );
    }
    return { body, status: response.status };
  }

  private async readBody(response: Response): Promise<OpenRouterResponse> {
    try {
      return (await response.json()) as OpenRouterResponse;
    } catch (error) {
      throw new LlmProviderError(
        `OpenRouter returned a non-JSON response (HTTP ${response.status})`,
        response.status,
        undefined,
        { cause: error },
      );
    }
  }

  private meta(body: OpenRouterResponse, startedAt: number): ProviderMeta {
    return {
      provider: this.name,
      model: body.model ?? this.model,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}
