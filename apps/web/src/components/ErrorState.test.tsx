import { ErrorCodeSchema } from '@pr-reviewer/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { errorResponses } from '@/mocks/fixtures';
import { errorMessage } from './ErrorState';

describe('errorMessage', () => {
  it('gives a non-empty, specific message for every error code', () => {
    const seen = new Set<string>();
    for (const code of ErrorCodeSchema.options) {
      const { status, message } = errorResponses[code];
      const text = errorMessage(new ApiError(code, message, status));
      expect(text.length, code).toBeGreaterThan(10);
      seen.add(text);
    }
    expect(seen.size).toBe(ErrorCodeSchema.options.length);
  });

  it('keeps the server message and adds a next step', () => {
    expect(
      errorMessage(
        new ApiError('NO_RULES', 'No rules file exists for acme/x.', 404),
      ),
    ).toBe(
      'No rules file exists for acme/x. Add rules for this repo in Projects.',
    );
  });

  it('tells the user the fix for setup errors instead of the server text', () => {
    expect(
      errorMessage(new ApiError('GH_NOT_AUTHENTICATED', 'x', 401)),
    ).toContain('gh auth login');
    expect(errorMessage(new ApiError('NETWORK', 'fetch failed', 0))).toContain(
      'pnpm dev',
    );
  });
});
