import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteRules, getRules, listRules, saveRules, templateFor, validateRulesYaml } from './index.js';
import type { DataPaths } from '../config/index.js';

const newPaths = async (): Promise<DataPaths> => {
  const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-rules-'));
  return { home, rules: join(home, 'rules'), database: join(home, 'data.db'), logs: join(home, 'logs'), config: join(home, 'config.yml') };
};
const validYaml = (repo = 'acme/billing') => `version: 1\nrepo: ${repo}\nenabled: true\nrules:\n  - id: pr-size\n    type: max_changed_lines\n    limit: 300\n    severity: minor\n`;

describe('rules files', () => {
  it('validates a rules document and reports a path with source line and column', () => {
    const result = validateRulesYaml(`version: 1\nrepo: acme/billing\nrules:\n  - id: pr-size\n    type: max_changed_lines\n    limit: nope\n    severity: major\n`);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ path: 'rules[0].limit', line: 6 });
    expect(result.errors[0]?.column).toBeGreaterThan(0);
  });

  it('requires the YAML repo to match the requested repo and exposes a template', () => {
    expect(validateRulesYaml(validYaml('acme/other'), 'acme/billing').errors[0]).toMatchObject({ path: 'repo', line: 2 });
    const template = validateRulesYaml(templateFor('acme/billing'), 'acme/billing');
    expect(template.valid).toBe(true);
    expect(template.parsed?.rules).toHaveLength(6);
    expect(template.parsed?.triggers.on_review_request).toBe('auto');
  });

  it('saves valid text byte-for-byte, lists projects, and deletes the file', async () => {
    const paths = await newPaths();
    const text = `# keep my comment\n${validYaml()}`;
    const saved = await saveRules(paths, 'acme/billing', text);
    expect(saved.valid).toBe(true);
    expect(await readFile(join(paths.rules, 'acme__billing.yml'), 'utf8')).toBe(text);
    await expect(getRules(paths, 'acme/billing')).resolves.toMatchObject({ valid: true, yaml: text, repo: 'acme/billing' });
    await expect(listRules(paths)).resolves.toMatchObject([{ repo: 'acme/billing', enabled: true, valid: true, ruleCount: 1, errorCount: 0 }]);
    expect(await deleteRules(paths, 'acme/billing')).toBe(true);
    expect(await deleteRules(paths, 'acme/billing')).toBe(false);
  });

  it('refuses invalid rules without writing them', async () => {
    const paths = await newPaths();
    const result = await saveRules(paths, 'acme/billing', validYaml().replace('limit: 300', 'limit: wrong'));
    expect(result.valid).toBe(false);
    await expect(readFile(join(paths.rules, 'acme__billing.yml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
