import { describe, expect, it } from 'vitest';
import {
  ApiSchemas,
  RulesFileSchema,
  ReviewOutputJsonSchema,
  ReviewOutputSchema,
} from './index.js';
import jsonSchema from '../review-output.schema.json' with { type: 'json' };

describe('shared contract', () => {
  it('accepts the documented rules example shape and rejects unknown rule types', () => {
    const rules = {
      version: 1,
      repo: 'acme/payments-api',
      enabled: true,
      triggers: {
        on_review_request: 'auto',
        on_new_commits: 'notify',
        skip_drafts: true,
      },
      review: {
        focus: {
          security: 'strict',
          correctness: 'strict',
          performance: 'normal',
          readability: 'light',
          style: 'off',
        },
        tone: 'Concise.',
        max_comments: 10,
        min_severity: 'minor',
        ignore_paths: [],
        context_files: [],
        instructions: '',
      },
      rules: [
        {
          id: 'pr-size',
          type: 'max_changed_lines',
          limit: 600,
          severity: 'minor',
        },
      ],
    };
    expect(RulesFileSchema.safeParse(rules).success).toBe(true);
    expect(
      RulesFileSchema.safeParse({
        ...rules,
        rules: [{ id: 'bad', type: 'mystery', severity: 'major' }],
      }).success,
    ).toBe(false);
  });

  it('keeps the checked-in LLM JSON Schema in sync with ReviewOutput', () => {
    expect(ReviewOutputJsonSchema).toEqual(jsonSchema);
    expect(
      ReviewOutputSchema.safeParse({
        summary: 'Looks good.',
        verdict: 'COMMENT',
        comments: [],
        ruleResults: [],
      }).success,
    ).toBe(true);
    const normalized = ReviewOutputSchema.parse({
      summary: 'One issue.',
      verdict: 'COMMENT',
      comments: [
        {
          path: 'src/a.ts',
          line: 1,
          side: 'RIGHT',
          severity: 'minor',
          ruleId: null,
          body: 'Fix this.',
          suggestion: null,
        },
      ],
      ruleResults: [],
    });
    expect(normalized.comments[0]).toEqual({
      path: 'src/a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'minor',
      body: 'Fix this.',
    });
  });

  it('accepts parsed rules in the project validation response', () => {
    expect(
      ApiSchemas.projects.validateResponse.safeParse({
        valid: true,
        errors: [],
        parsed: { version: 1, repo: 'acme/billing', rules: [] },
      }).success,
    ).toBe(true);
  });

  it('marks ignored files in diff responses', () => {
    expect(
      ApiSchemas.reviews.diff.parse([
        {
          path: 'generated/client.ts',
          status: 'modified',
          isBinary: false,
          ignored: true,
          additions: 1,
          deletions: 1,
          hunks: [],
        },
      ])[0],
    ).toMatchObject({ path: 'generated/client.ts', ignored: true });
  });

  it('validates the plain-English rules endpoint contract', () => {
    expect(
      ApiSchemas.projects.draftRules.parse({
        repo: 'acme/billing',
        description: 'Require tests for service changes.',
      }),
    ).toEqual({
      repo: 'acme/billing',
      description: 'Require tests for service changes.',
    });
    expect(
      ApiSchemas.projects.draftRules.safeParse({
        repo: 'not-a-repo',
        description: '',
      }).success,
    ).toBe(false);
    expect(
      ApiSchemas.projects.draftRulesResponse.safeParse({
        yaml: 'version: 1',
        valid: false,
        errors: [{ path: 'repo', message: 'Required' }],
      }).success,
    ).toBe(true);
    expect(
      ApiSchemas.projects.draftRulesError.parse({
        error: { code: 'LLM_FAILED', message: 'Provider unavailable' },
      }).error.code,
    ).toBe('LLM_FAILED');
  });
});
