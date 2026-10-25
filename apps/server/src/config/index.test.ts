import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeConfig, isLlmConfigured, resolveDataPaths, validateConfigYaml } from './index.js';

describe('application configuration', () => {
  it('creates the first-run data folders and default config', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-config-'));
    const { paths, config } = await initializeConfig({ env: { PR_REVIEWER_HOME: home }, cwd: home });
    expect(config.server.port).toBe(4317);
    expect(await readFile(paths.config, 'utf8')).toContain('interval_minutes: 5');
    expect((await stat(paths.rules)).isDirectory()).toBe(true);
    expect((await stat(paths.logs)).isDirectory()).toBe(true);
    expect(resolveDataPaths({ PR_REVIEWER_HOME: home }).home).toBe(home);
  });

  it('validates settings and determines API key presence without returning the key', () => {
    const config = validateConfigYaml('llm:\n  provider: anthropic\n  model: claude-test\n');
    expect(config.llm.model).toBe('claude-test');
    expect(isLlmConfigured(config, { ANTHROPIC_API_KEY: 'secret' })).toBe(true);
    expect(isLlmConfigured(config, {})).toBe(false);
    expect(isLlmConfigured(validateConfigYaml('llm:\n  provider: mock\n'), {})).toBe(true);
    expect(() => validateConfigYaml('server:\n  port: not-a-port\n')).toThrow(/Invalid config.yml/);
  });
});
