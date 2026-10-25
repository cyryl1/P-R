import { describe, expect, it } from 'vitest';
import { commentableSet, isValidAnchor, parseDiff, renderForPrompt } from './index.js';
import { diffCases } from '../test/fixtures/diff-cases.js';

describe('parseDiff', () => {
  it('tracks exact old and new lines across multiple hunks', () => {
    const files = parseDiff(diffCases.multiHunk);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'src/multi.ts', status: 'modified', additions: 2, deletions: 1 });
    expect(files[0]?.hunks.map((hunk) => hunk.lines.map((line) => [line.kind, line.oldLine, line.newLine]))).toEqual([
      [['context', 1, 1], ['del', 2, undefined], ['add', undefined, 2], ['context', 3, 3]],
      [['context', 20, 21], ['add', undefined, 22]],
    ]);
  });

  it('parses an added file', () => {
    expect(parseDiff(diffCases.added)[0]).toMatchObject({ path: 'src/new.ts', status: 'added', additions: 2, deletions: 0 });
  });

  it('parses a deleted file', () => {
    expect(parseDiff(diffCases.deleted)[0]).toMatchObject({ path: 'src/old.ts', status: 'deleted', additions: 0, deletions: 2 });
  });

  it('tracks both paths for a renamed file', () => {
    expect(parseDiff(diffCases.renamed)[0]).toMatchObject({ path: 'src/after.ts', oldPath: 'src/before.ts', status: 'renamed' });
  });

  it('marks a binary file and does not invent hunks', () => {
    expect(parseDiff(diffCases.binary)[0]).toMatchObject({ path: 'assets/logo.png', isBinary: true, hunks: [] });
  });

  it('ignores no-newline markers while retaining line anchors', () => {
    const files = parseDiff(diffCases.noNewline);
    expect(files[0]?.hunks[0]?.lines).toEqual([
      { kind: 'del', oldLine: 1, text: 'before' },
      { kind: 'add', newLine: 1, text: 'after' },
    ]);
  });

  it('builds commentable lines and prompt anchors', () => {
    const files = parseDiff(diffCases.multiHunk);
    const anchors = commentableSet(files);
    expect(isValidAnchor(anchors, 'src/multi.ts', 2, 'RIGHT')).toBe(true);
    expect(isValidAnchor(anchors, 'src/multi.ts', 3, 'LEFT')).toBe(false);
    expect(renderForPrompt(files)).toContain('R    2 + new');
    expect(renderForPrompt(files)).toContain('L    2 - old');
  });
});
