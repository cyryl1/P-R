import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import picomatch from 'picomatch';
import { initializeConfig } from './config/index.js';
import type { DataPaths } from './config/index.js';
import { createGhClient, type GhClient } from './gh/client.js';
import { getRules } from './rules/index.js';
import { parseDiff } from './diff/index.js';
import type { RulesFile } from '@pr-reviewer/shared';

export type ParsedPrUrl = { repo: string; number: number };
export type DryRunResult = {
  pr: { repo: string; number: number; title: string; author: string; url: string; baseRef: string; headRef: string; headSha: string; isDraft: boolean };
  fileStats: Array<{ path: string; status: string; additions: number; deletions: number; binary: boolean }>;
  total: { files: number; additions: number; deletions: number };
  rules: { state: 'none' | 'invalid' | 'disabled' | 'ok'; applies: Array<{ id: string; type: string; severity: string }>; skipped: Array<{ id: string; reason: string }> };
};

export function parsePrUrl(value: string): ParsedPrUrl {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('PR URL must be an absolute GitHub URL'); }
  if (!['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) throw new Error('Only github.com pull request URLs are supported');
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
  if (!match) throw new Error('PR URL must look like https://github.com/owner/repo/pull/123');
  return { repo: `${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}`, number: Number(match[3]) };
}

function matchesAny(path: string, globs: string[]) {
  return globs.length === 0 || globs.some((glob) => picomatch.isMatch(path, glob));
}

export function findApplicableRules(rules: RulesFile, files: ReturnType<typeof parseDiff>) {
  const applies: DryRunResult['rules']['applies'] = [];
  const skipped: DryRunResult['rules']['skipped'] = [];
  for (const rule of rules.rules) {
    if (rule.enabled === false) { skipped.push({ id: rule.id, reason: 'disabled' }); continue; }
    let applicable = true;
    let reason = '';
    if (rule.type === 'llm' && rule.paths?.length) applicable = files.some((file) => matchesAny(file.path, rule.paths!));
    if (rule.type === 'require_tests') applicable = files.some((file) => matchesAny(file.path, rule.when_paths));
    if (rule.type === 'forbid_paths') applicable = files.some((file) => matchesAny(file.path, rule.paths));
    if (!applicable) reason = 'no changed files match the rule paths';
    if (applicable) applies.push({ id: rule.id, type: rule.type, severity: rule.severity });
    else skipped.push({ id: rule.id, reason });
  }
  return { applies, skipped };
}

export async function runDryRun(url: string, gh: GhClient, paths: DataPaths): Promise<DryRunResult> {
  const { repo, number } = parsePrUrl(url);
  const [pr, rawDiff] = await Promise.all([gh.getPr(repo, number), gh.getDiff(repo, number)]);
  const files = parseDiff(rawDiff);
  const fileStats = files.map((file) => ({ path: file.path, status: file.status, additions: file.additions, deletions: file.deletions, binary: file.isBinary }));
  const total = fileStats.reduce((summary, file) => ({ files: summary.files + 1, additions: summary.additions + file.additions, deletions: summary.deletions + file.deletions }), { files: 0, additions: 0, deletions: 0 });
  let ruleState: DryRunResult['rules']['state'] = 'none';
  let applies: DryRunResult['rules']['applies'] = [];
  let skipped: DryRunResult['rules']['skipped'] = [];
  try {
    const rulesDoc = await getRules(paths, repo);
    if (!rulesDoc.valid || !rulesDoc.parsed) ruleState = 'invalid';
    else if (!rulesDoc.parsed.enabled) ruleState = 'disabled';
    else {
      ruleState = 'ok';
      ({ applies, skipped } = findApplicableRules(rulesDoc.parsed, files));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    pr: { repo, number, title: pr.title, author: pr.author.login, url: pr.url, baseRef: pr.baseRefName, headRef: pr.headRefName, headSha: pr.headRefOid, isDraft: pr.isDraft },
    fileStats,
    total,
    rules: { state: ruleState, applies, skipped },
  };
}

function printResult(result: DryRunResult, json: boolean) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${result.pr.repo}#${result.pr.number} ${result.pr.title}\n`);
  process.stdout.write(`Author: ${result.pr.author} · ${result.pr.baseRef} ← ${result.pr.headRef} (${result.pr.headSha.slice(0, 8)})\n`);
  process.stdout.write(`Files: ${result.total.files} · +${result.total.additions} / -${result.total.deletions}\n`);
  for (const file of result.fileStats) process.stdout.write(`  ${file.status.padEnd(8)} +${file.additions}/-${file.deletions}${file.binary ? ' binary' : ''} ${file.path}\n`);
  process.stdout.write(`Rules: ${result.rules.state}\n`);
  for (const rule of result.rules.applies) process.stdout.write(`  applies  ${rule.id} (${rule.type}, ${rule.severity})\n`);
  for (const rule of result.rules.skipped) process.stdout.write(`  skipped  ${rule.id} (${rule.reason})\n`);
}

async function main(args: string[]) {
  const url = args.find((argument) => !argument.startsWith('--'));
  const json = args.includes('--json');
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: pnpm review <pr-url> --dry-run [--json]\n');
    return;
  }
  if (!url || !args.includes('--dry-run')) throw new Error('Usage: pnpm review <pr-url> --dry-run [--json]');
  const { paths } = await initializeConfig();
  const result = await runDryRun(url, createGhClient(), paths);
  printResult(result, json);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Review dry-run failed'}\n`);
    process.exitCode = 1;
  });
}
