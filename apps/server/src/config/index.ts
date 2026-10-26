import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { parse, stringify } from 'yaml';
import { AppConfigSchema, type AppConfig } from '@pr-reviewer/shared';

export type DataPaths = { home: string; rules: string; database: string; logs: string; config: string };

export function resolveDataPaths(env: NodeJS.ProcessEnv = process.env): DataPaths {
  const home = resolve(env.PR_REVIEWER_HOME ?? join(homedir(), '.pr-reviewer'));
  return {
    home,
    rules: join(home, 'rules'),
    database: join(home, 'data.db'),
    logs: join(home, 'logs'),
    config: join(home, 'config.yml'),
  };
}

export const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({});

export async function initializeConfig(options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  const env = options.env ?? process.env;
  const paths = resolveDataPaths(env);
  loadDotEnv({ path: resolve(options.cwd ?? process.cwd(), '.env'), quiet: true });
  await Promise.all([mkdir(paths.rules, { recursive: true }), mkdir(paths.logs, { recursive: true })]);
  try {
    const text = await readFile(paths.config, 'utf8');
    return { paths, config: validateConfigYaml(text) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeFile(paths.config, stringify(DEFAULT_CONFIG), { flag: 'wx', mode: 0o600 });
    return { paths, config: DEFAULT_CONFIG };
  }
}

export function validateConfigYaml(text: string): AppConfig {
  const raw: unknown = parse(text);
  const result = AppConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`);
    throw new Error(`Invalid config.yml:\n${messages.join('\n')}`);
  }
  return result.data;
}

export async function saveConfigYaml(path: string, text: string): Promise<AppConfig> {
  const config = validateConfigYaml(text);
  const temporary = join(dirname(path), `.config-${randomUUID()}.tmp`);
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, path);
  return config;
}

export function isLlmConfigured(config: AppConfig, env: NodeJS.ProcessEnv = process.env): boolean {
  return config.llm.provider === 'mock' || Boolean(env.ANTHROPIC_API_KEY);
}
