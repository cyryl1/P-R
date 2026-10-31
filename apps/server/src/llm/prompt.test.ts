import { describe, expect, it } from 'vitest';
import { RulesFileSchema } from '@pr-reviewer/shared';
import type { GhPr } from '../gh/client.js';
import { parseDiff } from '../diff/index.js';
import { buildReviewPrompt } from './prompt.js';

const pr: GhPr = {
  number: 1,
  title: 'Harden auth',
  body: 'Closes #10',
  author: { login: 'octo' },
  url: 'https://github.com/acme/api/pull/1',
  baseRefName: 'main',
  headRefName: 'auth',
  headRefOid: 'head',
  isDraft: false,
  additions: 1,
  deletions: 0,
  files: [],
  closingIssuesReferences: [],
  state: 'OPEN',
};
const rules = RulesFileSchema.parse({
  version: 1,
  repo: 'acme/api',
  review: { tone: 'Direct.', max_comments: 4, min_severity: 'major' },
  rules: [
    { id: 'auth', type: 'llm', description: 'Endpoints require auth.', severity: 'blocker' },
  ],
});

describe('review prompt', () => {
  it('contains the contract, rule context, deterministic results, and anchors', () => {
    const files = parseDiff('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new');
    const built = buildReviewPrompt({
      pr,
      rules,
      files,
      contextFiles: [{ path: 'CONTRIBUTING.md', content: 'Be careful.' }],
      deterministicResults: [{ ruleId: 'tests', kind: 'deterministic', status: 'fail', note: 'Tests missing.', severity: 'major' }],
      maxInputTokens: 10_000,
    });
    expect(built.system).toMatchInlineSnapshot(
      `"You are a senior reviewer applying this reviewer's rules, not giving generic advice. Return only the requested structured review output. Only comment on lines shown with an R or L anchor and use that exact path, line, and side. Report one issue per comment. Do not create praise-only comments. Return at most 4 comments and nothing below severity major (rank 2). Tone: Direct."`,
    );
    expect(built.prompt).toContain('auth [blocker]: Endpoints require auth.');
    expect(built.prompt).toContain('tests: fail — Tests missing.');
    expect(built.prompt).toContain('R    1 + new');
  });

  it('records scope reductions when the budget is exceeded', () => {
    const files = parseDiff(`diff --git a/generated/huge.js b/generated/huge.js\n--- a/generated/huge.js\n+++ b/generated/huge.js\n@@ -0,0 +1,2 @@\n+${'x'.repeat(200)}\n+${'y'.repeat(200)}`);
    const built = buildReviewPrompt({ pr, rules, files, contextFiles: [], deterministicResults: [], maxInputTokens: 80 });
    expect(built.truncation.length).toBeGreaterThan(0);
    expect(built.prompt.length).toBeLessThanOrEqual(320);
  });

  it('retrieves rule-relevant hunks before unrelated large changes', () => {
    const relevantRules = RulesFileSchema.parse({
      ...rules,
      rules: [
        {
          id: 'auth',
          type: 'llm',
          description: 'Authorization middleware must enforce permissions.',
          paths: ['src/auth/**'],
          severity: 'blocker',
        },
      ],
    });
    const files = parseDiff(`diff --git a/docs/history.md b/docs/history.md
--- a/docs/history.md
+++ b/docs/history.md
@@ -0,0 +1,2 @@
+${'unrelated '.repeat(300)}
+${'archive '.repeat(300)}
diff --git a/src/auth/permissions.ts b/src/auth/permissions.ts
--- a/src/auth/permissions.ts
+++ b/src/auth/permissions.ts
@@ -1 +1,2 @@
 export const allowed = true;
+export const enforcePermission = () => allowed;
`);
    const built = buildReviewPrompt({
      pr,
      rules: relevantRules,
      files,
      contextFiles: [],
      deterministicResults: [],
      maxInputTokens: 500,
    });
    expect(built.prompt).toContain('src/auth/permissions.ts');
    expect(built.prompt).not.toContain('docs/history.md');
    expect(built.truncation.join(' ')).toContain('Retrieved');
  });
});
