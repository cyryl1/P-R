import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import { parse, stringify } from 'yaml';
import {
  AppConfigSchema,
  DEFAULT_OPENROUTER_MODEL,
  type AppConfig,
} from '@pr-reviewer/shared';

export type DataPaths = {
  home: string;
  rules: string;
  database: string;
  logs: string;
  config: string;
};

export function resolveDataPaths(
  env: NodeJS.ProcessEnv = process.env,
): DataPaths {
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

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

export async function initializeConfig(
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
) {
  const env = options.env ?? process.env;
  const paths = resolveDataPaths(env);
  loadDotEnv({
    path: resolve(options.cwd ?? repositoryRoot, '.env'),
    processEnv: env as Record<string, string>,
    quiet: true,
  });
  await Promise.all([
    mkdir(paths.rules, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
  ]);
  try {
    const text = await readFile(paths.config, 'utf8');
    const parsed = parseConfigYaml(text);
    if (parsed.migrated)
      await saveConfigYaml(paths.config, stringify(parsed.config));
    return { paths, config: parsed.config };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeFile(paths.config, stringify(DEFAULT_CONFIG), {
      flag: 'wx',
      mode: 0o600,
    });
    return { paths, config: DEFAULT_CONFIG };
  }
}

export function validateConfigYaml(text: string): AppConfig {
  return parseConfigYaml(text).config;
}

function parseConfigYaml(text: string): {
  config: AppConfig;
  migrated: boolean;
} {
  const raw: unknown = parse(text);
  let migrated = false;
  if (raw && typeof raw === 'object' && 'llm' in raw) {
    const llm = (raw as { llm?: unknown }).llm;
    if (llm && typeof llm === 'object' && 'provider' in llm) {
      const legacy = llm as {
        provider?: unknown;
        model?: unknown;
        max_input_tokens?: unknown;
      };
      if (legacy.provider === 'anthropic') {
        legacy.provider = 'openrouter';
        if (
          typeof legacy.model !== 'string' ||
          legacy.model.startsWith('claude-')
        ) {
          legacy.model = DEFAULT_OPENROUTER_MODEL;
        }
        if (legacy.max_input_tokens === 120000)
          legacy.max_input_tokens = 100000;
        migrated = true;
      }
      if (
        legacy.provider === 'openrouter' &&
        legacy.model === 'openrouter/free'
      ) {
        legacy.model = DEFAULT_OPENROUTER_MODEL;
        migrated = true;
      }
    }
  }
  const result = AppConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`,
    );
    throw new Error(`Invalid config.yml:\n${messages.join('\n')}`);
  }
  return { config: result.data, migrated };
}

export async function saveConfigYaml(
  path: string,
  text: string,
): Promise<AppConfig> {
  const config = validateConfigYaml(text);
  const temporary = join(dirname(path), `.config-${randomUUID()}.tmp`);
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, path);
  return config;
}

export function isLlmConfigured(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return config.llm.provider === 'mock' || Boolean(env.OPENROUTER_API_KEY);
}
