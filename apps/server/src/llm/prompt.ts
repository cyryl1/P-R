import picomatch from 'picomatch';
import type { Rule, RulesFile } from '@pr-reviewer/shared';
import type { DeterministicResult } from '../checks/index.js';
import type { ContextFile } from '../context/index.js';
import { renderForPrompt, type DiffFile } from '../diff/index.js';
import type { GhPr } from '../gh/client.js';

type DiffHunk = DiffFile['hunks'][number];

export type PromptInput = {
  pr: GhPr;
  rules: RulesFile;
  files: DiffFile[];
  contextFiles: ContextFile[];
  deterministicResults: DeterministicResult[];
  maxInputTokens: number;
};

export type BuiltPrompt = {
  system: string;
  prompt: string;
  files: DiffFile[];
  truncation: string[];
};

const severityRank = { nit: 0, minor: 1, major: 2, blocker: 3 } as const;
const generatedPattern = [
  '**/*.lock',
  '**/generated/**',
  '**/dist/**',
  '**/build/**',
  '**/*.min.*',
];
const sourcePattern = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|cs|php|swift|sql|graphql|ya?ml)$/i;
const stopWords = new Set([
  'about',
  'after',
  'before',
  'change',
  'changes',
  'check',
  'code',
  'from',
  'into',
  'review',
  'that',
  'this',
  'with',
]);

function retrievalTerms(input: PromptInput): string[] {
  const llmRuleText = input.rules.rules
    .filter((rule): rule is Extract<Rule, { type: 'llm' }> => rule.type === 'llm')
    .map((rule) => `${rule.description} ${rule.paths?.join(' ') ?? ''}`)
    .join(' ');
  const text = [
    input.pr.title,
    input.pr.body,
    input.rules.review.instructions,
    llmRuleText,
  ]
    .join(' ')
    .toLowerCase();
  return [
    ...new Set(
      text
        .split(/[^a-z0-9_./-]+/)
        .map((term) => term.trim())
        .filter(
          (term) =>
            term.length >= 4 && !stopWords.has(term) && !/^\d+$/.test(term),
        ),
    ),
  ].slice(0, 60);
}

function hunkScore(
  input: PromptInput,
  file: DiffFile,
  hunk: DiffHunk,
  terms: string[],
): number {
  const path = file.path.toLowerCase();
  const changedText = hunk.lines
    .filter((line) => line.kind !== 'context')
    .map((line) => line.text)
    .join('\n')
    .toLowerCase()
    .slice(0, 50_000);
  let score = sourcePattern.test(file.path) ? 20 : 0;
  score += Math.min(
    30,
    hunk.lines.filter((line) => line.kind !== 'context').length,
  );
  for (const rule of input.rules.rules) {
    if (
      rule.enabled !== false &&
      rule.type === 'llm' &&
      rule.paths?.some((pattern) => picomatch.isMatch(file.path, pattern))
    ) {
      score += 100 + severityRank[rule.severity] * 20;
    }
  }
  for (const term of terms) {
    if (path.includes(term)) score += 25;
    if (changedText.includes(term)) score += 5;
  }
  return score;
}

function compactHunk(hunk: DiffHunk, maximumCharacters: number): DiffHunk {
  if (maximumCharacters <= 0) return { ...hunk, lines: [] };
  const wanted = new Set<number>();
  hunk.lines.forEach((line, index) => {
    if (line.kind === 'context') return;
    for (let nearby = Math.max(0, index - 2); nearby <= Math.min(hunk.lines.length - 1, index + 2); nearby += 1)
      wanted.add(nearby);
  });
  let used = hunk.header.length;
  const selected = [...wanted]
    .sort((left, right) => left - right)
    .filter((index) => {
      const length = hunk.lines[index]!.text.length + 16;
      if (used + length > maximumCharacters) return false;
      used += length;
      return true;
    })
    .map((index) => hunk.lines[index]!);
  return {
    header: `${hunk.header} [retrieved ${selected.length}/${hunk.lines.length} lines]`,
    lines: selected,
  };
}

function retrieveRelevantDiff(
  input: PromptInput,
  files: DiffFile[],
  characterBudget: number,
): { files: DiffFile[]; selectedHunks: number; totalHunks: number } {
  const terms = retrievalTerms(input);
  const candidates = files.flatMap((file, fileIndex) =>
    file.hunks.map((hunk, hunkIndex) => ({
      file,
      hunk,
      fileIndex,
      hunkIndex,
      score: hunkScore(input, file, hunk, terms),
      length: renderForPrompt([{ ...file, hunks: [hunk] }]).length,
    })),
  );
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.fileIndex - right.fileIndex ||
      left.hunkIndex - right.hunkIndex,
  );

  let remaining = characterBudget;
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (candidate.length <= remaining) {
      selected.push(candidate);
      remaining -= candidate.length;
    }
  }
  if (selected.length === 0 && candidates.length > 0) {
    const candidate = candidates[0]!;
    const compacted = compactHunk(candidate.hunk, Math.max(500, characterBudget));
    selected.push({
      ...candidate,
      hunk: compacted,
      length: renderForPrompt([{ ...candidate.file, hunks: [compacted] }]).length,
    });
  }

  selected.sort(
    (left, right) =>
      left.fileIndex - right.fileIndex || left.hunkIndex - right.hunkIndex,
  );
  const byFile = new Map<DiffFile, DiffHunk[]>();
  for (const candidate of selected) {
    const hunks = byFile.get(candidate.file) ?? [];
    hunks.push(candidate.hunk);
    byFile.set(candidate.file, hunks);
  }
  return {
    files: files
      .filter((file) => byFile.has(file))
      .map((file) => ({ ...file, hunks: byFile.get(file)! })),
    selectedHunks: selected.length,
    totalHunks: candidates.length,
  };
}

const promptText = (
  input: Omit<PromptInput, 'maxInputTokens' | 'files'> & { files: DiffFile[] },
) => {
  const llmRules = input.rules.rules
    .filter(
      (rule): rule is Extract<Rule, { type: 'llm' }> =>
        rule.enabled !== false && rule.type === 'llm',
    )
    .map(
      (rule) =>
        `- ${rule.id} [${rule.severity}]: ${rule.description}${rule.paths?.length ? ` (paths: ${rule.paths.join(', ')})` : ''}`,
    )
    .join('\n');
  const checks = input.deterministicResults
    .map((item) => `- ${item.ruleId}: ${item.status} — ${item.note}`)
    .join('\n');
  const contexts = input.contextFiles
    .map((file) => `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\``)
    .join('\n\n');
  const { focus } = input.rules.review;
  return [
    `PR: ${input.pr.title}`,
    `Author: ${input.pr.author.login}`,
    `Base: ${input.pr.baseRefName}`,
    `Size: +${input.pr.additions} -${input.pr.deletions}`,
    `Description:\n${input.pr.body || '(none)'}`,
    `Focus: ${Object.entries(focus)
      .map(([name, level]) => `${name}=${level}`)
      .join(', ')}`,
    `Instructions:\n${input.rules.review.instructions || '(none)'}`,
    `LLM rules:\n${llmRules || '(none)'}`,
    `Deterministic results (already reported; do not repeat):\n${checks || '(none)'}`,
    `Context files:\n${contexts || '(none)'}`,
    `Anchored diff:\n${renderForPrompt(input.files) || '(empty)'}`,
  ].join('\n\n');
};

export function buildReviewPrompt(input: PromptInput): BuiltPrompt {
  const minimumSeverity = severityRank[input.rules.review.min_severity];
  const system = [
    "You are a senior reviewer applying this reviewer's rules, not giving generic advice.",
    'Return only the requested structured review output.',
    'Only comment on lines shown with an R or L anchor and use that exact path, line, and side.',
    'Report one issue per comment. Do not create praise-only comments.',
    `Return at most ${input.rules.review.max_comments} comments and nothing below severity ${input.rules.review.min_severity} (rank ${minimumSeverity}).`,
    `Tone: ${input.rules.review.tone || 'concise and actionable'}`,
  ].join(' ');
  let files = [...input.files];
  const truncation: string[] = [];
  let prompt = promptText({ ...input, files });
  const characterLimit = input.maxInputTokens * 4;

  if (prompt.length > characterLimit) {
    const removable = files.filter((file) =>
      generatedPattern.some((pattern) => picomatch.isMatch(file.path, pattern)),
    );
    if (removable.length > 0) {
      const removed = new Set(removable.map((file) => file.path));
      files = files.filter((file) => !removed.has(file.path));
      truncation.push(`Dropped generated/lock files: ${[...removed].join(', ')}`);
      prompt = promptText({ ...input, files });
    }
  }

  if (prompt.length > characterLimit && files.length > 0) {
    const baseLength = promptText({ ...input, files: [] }).length;
    const originalFiles = files.length;
    const retrieved = retrieveRelevantDiff(
      input,
      files,
      Math.max(1_000, characterLimit - baseLength - 500),
    );
    files = retrieved.files;
    truncation.push(
      `Retrieved ${retrieved.selectedHunks}/${retrieved.totalHunks} relevant diff hunks across ${files.length}/${originalFiles} files`,
    );
    prompt = promptText({ ...input, files });
  }

  if (prompt.length > characterLimit) {
    prompt = `${prompt.slice(0, Math.max(0, characterLimit - 80))}\n[truncated to token budget]`;
    truncation.push('Truncated prompt metadata/context to token budget');
  }
  return { system, prompt, files, truncation };
}
