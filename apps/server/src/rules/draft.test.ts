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
  it('repairs an unchanged draft once', async () => {
    const currentYaml = 'version: 1\nrepo: acme/billing\nrules: []\n';
    const changedYaml = templateFor('acme/billing').replace(
      'rules: []',
      'rules:\n  - id: require-tests\n    type: require_tests\n    severity: major\n    enabled: true',
    );
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce(generated(currentYaml))
      .mockResolvedValueOnce(generated(changedYaml));

    await expect(
      draftRules(
        { generateStructured },
        {
          repo: 'acme/billing',
          description: 'Require tests.',
          currentYaml,
        },
      ),
    ).resolves.toEqual({ yaml: changedYaml, valid: true, errors: [] });

    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(
      generateStructured.mock.calls[1]?.[0].validationFeedback,
    ).toContain('YAML is unchanged');
  });

  it('fails instead of reporting success when both drafts are unchanged', async () => {
    const currentYaml = 'version: 1\nrepo: acme/billing\nrules: []\n';
    const generateStructured = vi.fn().mockResolvedValue(generated(currentYaml));

    await expect(
      draftRules(
        { generateStructured },
        {
          repo: 'acme/billing',
          description: 'Require tests.',
          currentYaml,
        },
      ),
    ).rejects.toThrow(
      'The model returned the existing rules unchanged after one repair',
    );
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });

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

  it('fails instead of returning an invalid second draft', async () => {
    const invalid = 'version: 1\nrepo: acme/other\nrules: []\n';
    const generateStructured = vi.fn().mockResolvedValue(generated(invalid));

    await expect(
      draftRules(
        { generateStructured },
        { repo: 'acme/billing', description: 'Review carefully.' },
      ),
    ).rejects.toThrow(
      'The model returned invalid rules after one repair: repo: repo must match acme/billing',
    );
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });
});
