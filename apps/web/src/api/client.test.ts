import { ApiSchemas, ErrorCodeSchema, ReviewStatusSchema } from '@pr-reviewer/shared';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { api, ApiError } from './client';
import { reviewDetail } from '@/mocks/fixtures';

describe('api client', () => {
  it('parses a successful response through the shared schema', async () => {
    const health = await api.health();
    expect(health.gh.authenticated).toBe(true);
  });

  it('turns the backend error shape into an ApiError for every error code', async () => {
    for (const code of ErrorCodeSchema.options) {
      const original = globalThis.fetch;
      globalThis.fetch = (input, init) => original(input, { ...init, headers: { ...(init?.headers as Record<string, string>), 'x-mock-error': code } });
      try {
        await expect(api.inbox()).rejects.toMatchObject({ name: 'ApiError', code });
      } finally {
        globalThis.fetch = original;
      }
    }
  });

  it('returns undefined for 204 responses', async () => {
    await expect(api.deleteComment('rev_draft_ready', 'c1')).resolves.toBeUndefined();
  });

  it('maps a dropped connection to a NETWORK error', async () => {
    server.use(http.get('/api/health', () => HttpResponse.error()));
    await expect(api.health()).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('falls back to INTERNAL for a non-contract error body', async () => {
    server.use(http.get('/api/health', () => new HttpResponse('boom', { status: 502 })));
    const err = await api.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'INTERNAL', status: 502 });
  });
});

describe('mock fixtures', () => {
  it('serve a valid review detail for every status', async () => {
    for (const status of ReviewStatusSchema.options) {
      expect(() => ApiSchemas.reviews.detail.parse(reviewDetail(status))).not.toThrow();
      await expect(api.review(`rev_${status}`)).resolves.toMatchObject({ status });
    }
  });

  it('validate against the shared schemas for the list endpoints', async () => {
    await expect(api.inbox()).resolves.toHaveLength(8);
    await expect(api.projects()).resolves.toHaveLength(3);
    await expect(api.reviewDiff('rev_draft_ready')).resolves.toHaveLength(3);
    await expect(api.activity()).resolves.toMatchObject({ items: expect.any(Array) });
  });

  it('rejects edits to a review that is not editable', async () => {
    await expect(api.editReview('rev_submitted', { summary: 'x' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
