import { describe, expect, it } from 'vitest';
import { RulesFileSchema, type Rule } from '@pr-reviewer/shared';
import type { DiffFile } from '../diff/index.js';
import type { GhPr } from '../gh/client.js';
import { runCheck, runDeterministicChecks } from './index.js';

const pr: GhPr = {
  number: 7,
  title: 'Add billing',
  body: 'Implements #42 with enough detail for reviewers.',
  author: { login: 'octo' },
  url: 'https://github.com/acme/billing/pull/7',
  baseRefName: 'main',
  headRefName: 'feature',
  headRefOid: 'abc123',
  isDraft: false,
  additions: 8,
  deletions: 2,
  files: [],
  closingIssuesReferences: [],
  state: 'OPEN',
};
const files: DiffFile[] = [
  {
    path: 'src/pay.ts',
    status: 'modified',
    isBinary: false,
    additions: 8,
    deletions: 2,
    hunks: [],
  },
  {
    path: 'src/pay.test.ts',
    status: 'modified',
    isBinary: false,
    additions: 1,
    deletions: 0,
    hunks: [],
  },
];
const rules = RulesFileSchema.parse({
  version: 1,
  repo: 'acme/billing',
  review: { ignore_paths: ['vendor/**'] },
  rules: [],
});

describe('deterministic checks', () => {
  it.each([
    [
      { id: 'tests', type: 'require_tests', when_paths: ['src/*.ts'], test_paths: ['**/*.test.ts'], severity: 'major' },
      'pass',
    ],
    [{ id: 'size', type: 'max_changed_lines', limit: 5, severity: 'minor' }, 'fail'],
    [{ id: 'forbid', type: 'forbid_paths', paths: ['.env*'], severity: 'blocker' }, 'pass'],
    [{ id: 'description', type: 'require_description', min_length: 20, severity: 'minor' }, 'pass'],
    [{ id: 'issue', type: 'require_linked_issue', severity: 'nit' }, 'pass'],
  ] as const)('evaluates %s', (raw, expected) => {
    expect(
      runCheck(
        { pr, files, rules },
        raw as Exclude<Rule, { type: 'llm' }>,
      ).status,
    ).toBe(expected);
  });

  it('skips disabled and LLM rules', () => {
    const configured = RulesFileSchema.parse({
      version: 1,
      repo: 'acme/billing',
      rules: [
        { id: 'size', type: 'max_changed_lines', limit: 100, severity: 'minor' },
        { id: 'disabled', type: 'forbid_paths', paths: ['src/**'], severity: 'major', enabled: false },
        { id: 'llm-rule', type: 'llm', description: 'Check safety', severity: 'major' },
      ],
    });
    expect(runDeterministicChecks({ pr, files, rules: configured })).toHaveLength(1);
  });
});
