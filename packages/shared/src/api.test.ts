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
});
