import type { DiffSide } from '@pr-reviewer/shared';

export type DiffLine = { kind: 'add' | 'del' | 'context'; oldLine?: number; newLine?: number; text: string };
export type DiffHunk = { header: string; lines: DiffLine[] };
export type DiffFile = {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  isBinary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
};
export type CommentableFileLines = { RIGHT: Set<number>; LEFT: Set<number> };
export type CommentableSet = Map<string, CommentableFileLines>;

const unquoteGitPath = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  return value;
};

function splitDiffHeader(line: string): { oldPath: string; newPath: string } | undefined {
  const match = line.match(/^diff --git (.+) (.+)$/);
  if (!match) return undefined;
  return { oldPath: unquoteGitPath(match[1]!.replace(/^a\//, '')), newPath: unquoteGitPath(match[2]!.replace(/^b\//, '')) };
}

function pathFromFileHeader(line: string) {
  const path = line.slice(4).split('\t', 1)[0]!.trim();
  if (path === '/dev/null') return path;
  return unquoteGitPath(path.replace(/^[ab]\//, ''));
}

export function parseDiff(raw: string): DiffFile[] {
  const lines = raw.split(/\r?\n/);
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith('diff --git ')) {
      const header = splitDiffHeader(line);
      if (!header) continue;
      current = {
        path: header.newPath,
        status: 'modified',
        isBinary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('rename from ')) {
      current.oldPath = unquoteGitPath(line.slice('rename from '.length));
      current.status = 'renamed';
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.path = unquoteGitPath(line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('new file mode ')) { current.status = 'added'; continue; }
    if (line.startsWith('deleted file mode ')) { current.status = 'deleted'; continue; }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      current.isBinary = true;
      inHunk = false;
      continue;
    }
    if (line.startsWith('--- ')) {
      const oldPath = pathFromFileHeader(line);
      const plus = lines[index + 1];
      if (plus?.startsWith('+++ ')) {
        const newPath = pathFromFileHeader(plus);
        if (oldPath === '/dev/null') current.status = 'added';
        else if (newPath === '/dev/null') current.status = 'deleted';
        else if (oldPath !== newPath) { current.status = 'renamed'; current.oldPath ??= oldPath; }
        if (newPath !== '/dev/null') current.path = newPath;
      }
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      current.hunks.push({ header: line, lines: [] });
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('\\ No newline at end of file')) continue;
    const hunk = current.hunks.at(-1);
    if (!hunk) continue;
    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', newLine, text: line.slice(1) });
      current.additions += 1;
      newLine += 1;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', oldLine, text: line.slice(1) });
      current.deletions += 1;
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ kind: 'context', oldLine, newLine, text: line.slice(1) });
      oldLine += 1;
      newLine += 1;
    } else {
      inHunk = false;
    }
  }
  return files;
}

export function commentableSet(files: DiffFile[]): CommentableSet {
  const anchors: CommentableSet = new Map();
  for (const file of files) {
    const entry: CommentableFileLines = { RIGHT: new Set<number>(), LEFT: new Set<number>() };
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if ((line.kind === 'add' || line.kind === 'context') && line.newLine !== undefined) entry.RIGHT.add(line.newLine);
        if (line.kind === 'del' && line.oldLine !== undefined) entry.LEFT.add(line.oldLine);
      }
    }
    anchors.set(file.path, entry);
  }
  return anchors;
}

export function isValidAnchor(anchors: CommentableSet, path: string, line: number, side: DiffSide): boolean {
  return anchors.get(path)?.[side].has(line) ?? false;
}

export function renderForPrompt(files: DiffFile[]): string {
  return files.map((file) => {
    const body = file.hunks.flatMap((hunk) => [hunk.header, ...hunk.lines.map((line) => {
      if (line.kind === 'add') return `R ${String(line.newLine).padStart(4)} + ${line.text}`;
      if (line.kind === 'del') return `L ${String(line.oldLine).padStart(4)} - ${line.text}`;
      return `R ${String(line.newLine).padStart(4)}   ${line.text}`;
    })]).join('\n');
    return `### ${file.path}${file.oldPath ? ` (renamed from ${file.oldPath})` : ''}${file.isBinary ? ' [binary]' : ''}\n${body}`;
  }).join('\n\n');
}
