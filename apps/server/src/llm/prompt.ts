import picomatch from 'picomatch';
import type { Rule, RulesFile } from '@pr-reviewer/shared';
import type { DeterministicResult } from '../checks/index.js';
import type { ContextFile } from '../context/index.js';
import { renderForPrompt, type DiffFile } from '../diff/index.js';
import type { GhPr } from '../gh/client.js';

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

  while (prompt.length > characterLimit && files.length > 0) {
    const largest = [...files].sort(
      (left, right) =>
        renderForPrompt([right]).length - renderForPrompt([left]).length,
    )[0]!;
    const lines = largest.hunks.flatMap((hunk) => hunk.lines).length;
    files = files.filter((file) => file !== largest);
    truncation.push(`Dropped ${largest.path} (${lines} diff lines) for token budget`);
    prompt = promptText({ ...input, files });
  }

  if (prompt.length > characterLimit) {
    prompt = `${prompt.slice(0, Math.max(0, characterLimit - 80))}\n[truncated to token budget]`;
    truncation.push('Truncated prompt metadata/context to token budget');
  }
  return { system, prompt, files, truncation };
}
