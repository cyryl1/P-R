import picomatch from 'picomatch';
import type { RulesFile } from '@pr-reviewer/shared';
import type { DataPaths } from '../config/index.js';
import { parseDiff, type DiffFile } from '../diff/index.js';
import type { GhClient, GhPr } from '../gh/client.js';
import { getRules } from '../rules/index.js';

export type ContextFile = { path: string; content: string };
export type GatheredContext = {
  repo: string;
  number: number;
  pr: GhPr;
  diffRaw: string;
  files: DiffFile[];
  promptFiles: DiffFile[];
  contextFiles: ContextFile[];
  rulesForRepo: RulesFile;
  warnings: string[];
};

const matchesAny = (path: string, patterns: string[]) =>
  patterns.some((pattern) => picomatch.isMatch(path, pattern));

export async function gatherContext(
  gh: GhClient,
  paths: DataPaths,
  repo: string,
  number: number,
): Promise<GatheredContext> {
  const rulesDocument = await getRules(paths, repo);
  if (!rulesDocument.valid || !rulesDocument.parsed)
    throw new Error(`Rules for ${repo} are invalid`);
  if (!rulesDocument.parsed.enabled)
    throw new Error(`Rules for ${repo} are disabled`);

  const [pr, diffRaw] = await Promise.all([
    gh.getPr(repo, number),
    gh.getDiff(repo, number),
  ]);
  const files = parseDiff(diffRaw);
  const promptFiles = files.filter(
    (file) =>
      !matchesAny(file.path, rulesDocument.parsed!.review.ignore_paths),
  );
  const warnings: string[] = [];
  const contextFiles: ContextFile[] = [];
  for (const path of rulesDocument.parsed.review.context_files) {
    try {
      const raw = await gh.getFile(repo, path, pr.headRefOid);
      const content = raw.slice(0, 20_000);
      contextFiles.push({ path, content });
      if (raw.length > content.length)
        warnings.push(`${path} truncated to 20000 characters`);
    } catch {
      warnings.push(`Context file unavailable: ${path}`);
    }
  }

  return {
    repo,
    number,
    pr,
    diffRaw,
    files,
    promptFiles,
    contextFiles,
    rulesForRepo: rulesDocument.parsed,
    warnings,
  };
}
