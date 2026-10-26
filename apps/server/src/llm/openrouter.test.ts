import { describe, expect, it, vi } from 'vitest';
import { createReviewProvider } from './index.js';
import { OpenRouterProvider } from './openrouter.js';
import { LlmNotConfiguredError, LlmProviderError } from './provider.js';
import { AppConfigSchema } from '@pr-reviewer/shared';

const validReview = {
  summary: 'One correctness issue needs attention.',
  verdict: 'REQUEST_CHANGES',
  comments: [
    {
      path: 'src/invoice.ts',
      line: 12,
      side: 'RIGHT',
      severity: 'major',
      ruleId: 'no-duplicates',
      body: 'This can create the invoice twice.',
      suggestion: null,
    },
  ],
  ruleResults: [
    {
      ruleId: 'no-duplicates',
      status: 'fail',
      note: 'Duplicate creation is possible.',
    },
  ],
};

const openRouterResponse = (
  content: unknown,
  options: { status?: number; model?: string } = {},
) =>
  new Response(
    JSON.stringify({
      model: options.model ?? 'nvidia/nemotron-free',
      choices: [
        {
          message: {
            content:
              typeof content === 'string' ? content : JSON.stringify(content),
          },
        },
      ],
      usage: { prompt_tokens: 1200, completion_tokens: 180 },
    }),
    {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json' },
    },
  );

describe('OpenRouterProvider', () => {
  it('sends the review schema and returns normalized output with actual model metadata', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      openRouterResponse(validReview),
    );
    const provider = new OpenRouterProvider({
      apiKey: 'test-key',
      model: 'openrouter/free',
      fetch,
      appUrl: 'https://example.test',
    });

    const result = await provider.review({
      system: 'Review safely.',
      prompt: 'Review this diff.',
    });

    expect(result.output.comments[0]).toEqual({
      path: 'src/invoice.ts',
      line: 12,
      side: 'RIGHT',
      severity: 'major',
      ruleId: 'no-duplicates',
      body: 'This can create the invoice twice.',
    });
    expect(result.meta).toMatchObject({
      provider: 'openrouter',
      model: 'nvidia/nemotron-free',
      inputTokens: 1200,
      outputTokens: 180,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'HTTP-Referer': 'https://example.test',
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'openrouter/free',
      max_tokens: 8000,
      temperature: 0,
      provider: { require_parameters: true },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'review_output', strict: true },
      },
    });
    const schema = (
      body.response_format as {
        json_schema: { schema: { required: string[] } };
      }
    ).json_schema.schema;
    expect(schema.required).toEqual([
      'summary',
      'verdict',
      'comments',
      'ruleResults',
    ]);
  });

  it('retries malformed structured output once with validation feedback', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(openRouterResponse('{not json'))
      .mockResolvedValueOnce(openRouterResponse(validReview));
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch });

    await expect(
      provider.review({ system: 'System', prompt: 'Prompt' }),
    ).resolves.toMatchObject({
      output: { verdict: 'REQUEST_CHANGES' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)) as {
      messages: Array<{ content: string }>;
    };
    expect(retryBody.messages.at(-1)?.content).toContain(
      'previous response was invalid',
    );
  });

  it('does not retry HTTP errors that consume the free quota', async () => {
    const response = new Response(
      JSON.stringify({ error: { message: 'Daily free-model limit reached' } }),
      {
        status: 429,
        headers: { 'retry-after': '60' },
      },
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch });

    await expect(
      provider.review({ system: 'System', prompt: 'Prompt' }),
    ).rejects.toMatchObject({
      name: 'LlmProviderError',
      status: 429,
      retryAfter: '60',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('fails before making a request when the key is missing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new OpenRouterProvider({ fetch });

    await expect(
      provider.review({ system: 'System', prompt: 'Prompt' }),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails after exactly one retry when both outputs are invalid', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      openRouterResponse('{}'),
    );
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch });

    await expect(
      provider.review({ system: 'System', prompt: 'Prompt' }),
    ).rejects.toBeInstanceOf(LlmProviderError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('createReviewProvider', () => {
  it('creates OpenRouter from the default app config', () => {
    const provider = createReviewProvider(AppConfigSchema.parse({}), {
      OPENROUTER_API_KEY: 'test-key',
    });
    expect(provider).toMatchObject({
      name: 'openrouter',
      model: 'openrouter/free',
    });
  });

  it('keeps the mock provider available for offline tests', async () => {
    const config = AppConfigSchema.parse({
      llm: { provider: 'mock', model: 'mock' },
    });
    const provider = createReviewProvider(config, {});
    await expect(
      provider.review({ system: '', prompt: '' }),
    ).resolves.toMatchObject({
      output: { summary: 'Mock review completed.', verdict: 'COMMENT' },
      meta: { provider: 'mock' },
    });
  });
});
