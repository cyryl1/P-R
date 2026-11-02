import { describe, expect, it, vi } from 'vitest';
import { templateFor } from './index.js';
import { draftRules } from './draft.js';

const generated = (yaml: string) => ({
  content: JSON.stringify({ yaml }),
  meta: {
    provider: 'test',
    model: 'test',
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  },
});

describe('plain-English rules drafting', () => {
  it('repairs invalid YAML once and applies changes to current YAML', async () => {
    const valid = templateFor('acme/billing');
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce(
        generated('version: 1\nrepo: acme/other\nrules: []\n'),
      )
      .mockResolvedValueOnce(generated(valid));

    await expect(
      draftRules(
        { generateStructured },
        {
          repo: 'acme/billing',
          description: 'Require tests for TypeScript changes.',
          currentYaml: 'version: 1\nrepo: acme/billing\nrules: []\n',
        },
      ),
    ).resolves.toEqual({ yaml: valid, valid: true, errors: [] });

    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.calls[0]?.[0].prompt).toContain(
      '<current-yaml>',
    );
    expect(
      generateStructured.mock.calls[1]?.[0].validationFeedback,
    ).toContain('repo must match acme/billing');
  });

  it('returns the second invalid draft and its validation errors', async () => {
    const invalid = 'version: 1\nrepo: acme/other\nrules: []\n';
    const generateStructured = vi.fn().mockResolvedValue(generated(invalid));

    await expect(
      draftRules(
        { generateStructured },
        { repo: 'acme/billing', description: 'Review carefully.' },
      ),
    ).resolves.toMatchObject({
      yaml: invalid,
      valid: false,
      errors: [
        expect.objectContaining({
          path: 'repo',
          message: 'repo must match acme/billing',
        }),
      ],
    });
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });
});
