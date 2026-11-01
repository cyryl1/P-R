import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../index.js';
import type { GhClient } from '../gh/client.js';

const apps: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('production web server', () => {
  it('serves built assets and falls back to the SPA without swallowing API 404s', async () => {
    const webDist = await mkdtemp(join(tmpdir(), 'pr-reviewer-web-'));
    await mkdir(join(webDist, 'assets'));
    await writeFile(
      join(webDist, 'index.html'),
      '<!doctype html><div id="root"></div>',
    );
    await writeFile(join(webDist, 'assets', 'app.js'), 'window.ready = true;');
    const app = createServer({
      production: true,
      webDist,
      logger: false,
      gh: { authStatus: async () => ({ login: 'octo' }) } as GhClient,
    });
    apps.push(app);

    const page = await app.inject({
      method: 'GET',
      url: '/reviews/example',
      headers: { host: 'localhost' },
    });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['cache-control']).toBe('no-cache');

    const asset = await app.inject({
      method: 'GET',
      url: '/assets/app.js',
      headers: { host: '127.0.0.1:4317' },
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.headers['cache-control']).toContain('immutable');

    const missingApi = await app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
      headers: { host: 'localhost' },
    });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toMatchObject({
      error: { code: 'INTERNAL', message: 'API endpoint not found' },
    });

    const traversal = await app.inject({
      method: 'GET',
      url: '/%2e%2e%2fsecret.txt',
      headers: { host: 'localhost' },
    });
    expect(traversal.statusCode).toBe(404);
  });
});
