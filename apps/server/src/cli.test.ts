import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parsePrUrl, runDryRun } from './cli.js';
import type { DataPaths } from './config/index.js';
import type { GhClient } from './gh/client.js';
import { saveRules } from './rules/index.js';
import { ghPrFixture, diffCases } from './test/fixtures/diff-cases.js';

const pathsForTest = async (): Promise<DataPaths> => {
  const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-cli-'));
  return { home, rules: join(home, 'rules'), database: join(home, 'data.db'), logs: join(home, 'logs'), config: join(home, 'config.yml') };
};

describe('review dry-run CLI helpers', () => {
  it('accepts GitHub pull request URLs and rejects unrelated URLs', () => {
    expect(parsePrUrl('https://github.com/acme/billing/pull/42')).toEqual({ repo: 'acme/billing', number: 42 });
    expect(() => parsePrUrl('https://example.com/acme/billing/pull/42')).toThrow(/Only github.com/);
    expect(() => parsePrUrl('https://github.com/acme/billing/issues/42')).toThrow(/PR URL/);
  });

  it('reports metadata, diff stats, and applicable rules without writing review state', async () => {
    const paths = await pathsForTest();
    const yaml = `version: 1\nrepo: acme/billing\nenabled: true\nreview:\n  ignore_paths: ["docs/**"]\nrules:\n  - id: source-review\n    type: llm\n    description: Check source changes\n    paths: ["src/**"]\n    severity: major\n  - id: docs-only\n    type: llm\n    description: Check docs\n    paths: ["docs/**"]\n    severity: nit\n`;
    await saveRules(paths, 'acme/billing', yaml);
    const gh = {
      getPr: vi.fn(async () => ghPrFixture),
      getDiff: vi.fn(async () => diffCases.multiHunk),
    } as unknown as GhClient;
    const result = await runDryRun('https://github.com/acme/billing/pull/42', gh, paths);
    expect(result.pr).toMatchObject({ repo: 'acme/billing', number: 42, title: ghPrFixture.title, author: 'octocat', headSha: ghPrFixture.headRefOid });
    expect(result.total).toEqual({ files: 1, additions: 2, deletions: 1 });
    expect(result.rules.state).toBe('ok');
    expect(result.rules.applies.map((rule) => rule.id)).toEqual(['source-review']);
    expect(result.rules.skipped).toEqual([{ id: 'docs-only', reason: 'no changed files match the rule paths' }]);
    expect(gh.getPr).toHaveBeenCalledWith('acme/billing', 42);
  });
});
