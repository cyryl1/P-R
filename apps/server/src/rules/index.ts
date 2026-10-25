import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument, stringify, type Node as YamlNode } from 'yaml';
import { RulesFileSchema, type RulesFile } from '@pr-reviewer/shared';
import type { DataPaths } from '../config/index.js';

type RulesError = { path: string; message: string; line?: number; column?: number };

export type RulesValidation = { valid: boolean; parsed?: RulesFile; errors: RulesError[] };
export type ProjectSummary = { repo: string; enabled: boolean; valid: boolean; ruleCount: number; updatedAt?: string; errorCount: number };

const slug = (repo: string) => {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new Error('Repository must use owner/repo format');
  return repo.replace('/', '__');
};
const fileName = (repo: string) => `${slug(repo)}.yml`;
const yamlOffsetForPath = (doc: ReturnType<typeof parseDocument>, path: Array<string | number>): number | undefined => {
  const node = doc.getIn(path, true) as YamlNode | null | undefined;
  return node && 'range' in node && node.range ? node.range[0] : undefined;
};
const locationAt = (text: string, offset?: number) => {
  if (offset === undefined) return {};
  const prefix = text.slice(0, offset);
  const line = prefix.split('\n').length;
  const column = offset - prefix.lastIndexOf('\n');
  return { line, column };
};

export function validateRulesYaml(text: string, expectedRepo?: string): RulesValidation {
  const document = parseDocument(text, { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      valid: false,
      errors: document.errors.map((error) => {
        const pos = error.linePos?.[0];
        return { path: '', message: error.message, ...(pos ? { line: pos.line, column: pos.col } : {}) };
      }),
    };
  }
  const parsed = document.toJS() as unknown;
  const result = RulesFileSchema.safeParse(parsed);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => {
        const path = issue.path.reduce<string>((formatted, part, index) => {
          if (typeof part === 'number') return `${formatted}[${part}]`;
          return `${formatted}${index === 0 ? '' : '.'}${String(part)}`;
        }, '');
        return {
          path,
          message: issue.message,
          ...locationAt(text, yamlOffsetForPath(document, issue.path as Array<string | number>)),
        };
      }),
    };
  }
  if (expectedRepo && result.data.repo !== expectedRepo) {
    const repoOffset = yamlOffsetForPath(document, ['repo']);
    return { valid: false, errors: [{ path: 'repo', message: `repo must match ${expectedRepo}`, ...locationAt(text, repoOffset) }] };
  }
  return { valid: true, parsed: result.data, errors: [] };
}

export function templateFor(repo: string): string {
  return stringify({
    version: 1,
    repo,
    enabled: true,
    triggers: { on_review_request: 'auto', on_new_commits: 'notify', skip_drafts: true },
    review: {
      focus: { security: 'strict', correctness: 'strict', performance: 'normal', readability: 'light', style: 'off' },
      tone: 'Concise. Suggest a fix, not just the problem.', max_comments: 10, min_severity: 'minor',
      ignore_paths: ['**/*.lock', 'docs/**', 'generated/**'],
      context_files: ['CONTRIBUTING.md', 'src/middleware/auth.ts'],
      instructions: 'We use Result types, never throw in services.\nMoney is always integer minor units.',
    },
    rules: [
      { id: 'auth-on-endpoints', type: 'llm', description: 'Every new HTTP endpoint uses the requireAuth middleware.', severity: 'blocker', paths: ['src/routes/**'] },
      { id: 'tests-for-logic', type: 'require_tests', when_paths: ['src/**/*.ts'], test_paths: ['**/*.test.ts', 'tests/**'], severity: 'major' },
      { id: 'pr-size', type: 'max_changed_lines', limit: 600, severity: 'minor' },
      { id: 'no-env-files', type: 'forbid_paths', paths: ['.env*', '**/*.pem'], severity: 'blocker' },
      { id: 'has-description', type: 'require_description', min_length: 30, severity: 'minor' },
      { id: 'linked-issue', type: 'require_linked_issue', severity: 'nit' },
    ],
  });
}

export async function getRules(paths: DataPaths, repo: string): Promise<{ repo: string; yaml: string; valid: boolean; parsed?: RulesFile; errors: RulesError[] }> {
  const yaml = await readFile(join(paths.rules, fileName(repo)), 'utf8');
  return { repo, yaml, ...validateRulesYaml(yaml, repo) };
}

export async function saveRules(paths: DataPaths, repo: string, yaml: string) {
  const validation = validateRulesYaml(yaml, repo);
  if (!validation.valid) return { repo, yaml, ...validation };
  await mkdir(paths.rules, { recursive: true });
  const destination = join(paths.rules, fileName(repo));
  const temporary = join(paths.rules, `.${fileName(repo)}-${randomUUID()}.tmp`);
  await writeFile(temporary, yaml, { flag: 'wx', mode: 0o600 });
  await rename(temporary, destination);
  return { repo, yaml, ...validation };
}

export async function deleteRules(paths: DataPaths, repo: string) {
  try {
    await unlink(join(paths.rules, fileName(repo)));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function listRules(paths: DataPaths): Promise<ProjectSummary[]> {
  await mkdir(paths.rules, { recursive: true });
  const entries = await readdir(paths.rules);
  const projects = await Promise.all(entries.filter((entry) => /^[^/]+__[^/]+\.ya?ml$/.test(entry)).map(async (entry) => {
    const repo = entry.replace(/\.ya?ml$/, '').replace('__', '/');
    const path = join(paths.rules, entry);
    const [yaml, metadata] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    const validation = validateRulesYaml(yaml, repo);
    return {
      repo,
      enabled: validation.parsed?.enabled ?? false,
      valid: validation.valid,
      ruleCount: validation.parsed?.rules.length ?? 0,
      updatedAt: metadata.mtime.toISOString(),
      errorCount: validation.errors.length,
    } satisfies ProjectSummary;
  }));
  return projects.sort((left, right) => left.repo.localeCompare(right.repo));
}

export async function hasRules(paths: DataPaths, repo: string): Promise<boolean> {
  try {
    await access(join(paths.rules, fileName(repo)));
    return true;
  } catch {
    return false;
  }
}
