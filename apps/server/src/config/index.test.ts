import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  initializeConfig,
  isLlmConfigured,
  resolveDataPaths,
  validateConfigYaml,
} from './index.js';

describe('application configuration', () => {
  it('creates the first-run data folders and default config', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-config-'));
    const { paths, config } = await initializeConfig({
      env: { PR_REVIEWER_HOME: home },
      cwd: home,
    });
    expect(config.server.port).toBe(4317);
    expect(await readFile(paths.config, 'utf8')).toContain(
      'interval_minutes: 5',
    );
    expect((await stat(paths.rules)).isDirectory()).toBe(true);
    expect((await stat(paths.logs)).isDirectory()).toBe(true);
    expect(resolveDataPaths({ PR_REVIEWER_HOME: home }).home).toBe(home);
  });

  it('loads the API key from the selected environment directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-env-'));
    const env: NodeJS.ProcessEnv = { PR_REVIEWER_HOME: home };
    await writeFile(join(home, '.env'), 'OPENROUTER_API_KEY=test-key\n');

    await initializeConfig({ env, cwd: home });

    expect(env.OPENROUTER_API_KEY).toBe('test-key');
  });

  it('validates settings and determines API key presence without returning the key', () => {
    const config = validateConfigYaml(
      'llm:\n  provider: openrouter\n  model: openrouter/free\n',
    );
    expect(config.llm.model).toBe('openrouter/free');
    expect(isLlmConfigured(config, { OPENROUTER_API_KEY: 'secret' })).toBe(
      true,
    );
    expect(isLlmConfigured(config, {})).toBe(false);
    expect(
      isLlmConfigured(validateConfigYaml('llm:\n  provider: mock\n'), {}),
    ).toBe(true);
    expect(() => validateConfigYaml('server:\n  port: not-a-port\n')).toThrow(
      /Invalid config.yml/,
    );
  });

  it('migrates the former Anthropic default to OpenRouter', () => {
    const config = validateConfigYaml(`llm:
  provider: anthropic
  model: claude-sonnet-5-5
  max_input_tokens: 120000
`);
    expect(config.llm).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/free',
      max_input_tokens: 100000,
    });
  });
});
