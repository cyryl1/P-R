import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppConfigSchema } from '@pr-reviewer/shared';
import { resolveDataPaths } from '../config/index.js';
import type { GhClient } from '../gh/client.js';
import { createServer } from '../index.js';

const apps: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('settings endpoints', () => {
  it('reads, partially updates, and persists validated settings', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pr-reviewer-settings-'));
    const paths = resolveDataPaths({ PR_REVIEWER_HOME: home });
    const config = AppConfigSchema.parse({
      llm: {
        provider: 'mock',
        model: 'original-model',
        max_input_tokens: 12345,
      },
    });
    const app = createServer({
      paths,
      config,
      gh: { authStatus: async () => ({ login: 'octocat' }) } as GhClient,
    });
    apps.push(app);

    const get = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { host: 'localhost' },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({
      llm: {
        provider: 'mock',
        model: 'original-model',
        max_input_tokens: 12345,
      },
    });

    const update = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { host: 'localhost' },
      payload: { llm: { model: 'new-model' } },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      llm: {
        provider: 'mock',
        model: 'new-model',
        max_input_tokens: 12345,
      },
    });
    expect(await readFile(paths.config, 'utf8')).toContain('model: new-model');

    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { host: 'localhost' },
      payload: { jobs: { concurrency: 0 } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
  });
});
