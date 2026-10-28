import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from './index.js';
import type { GhClient } from './gh/client.js';

const app = createServer({
  gh: { authStatus: async () => ({ login: 'octocat' }) } as unknown as GhClient,
  env: { OPENROUTER_API_KEY: 'set-but-never-returned' },
});
afterAll(async () => app.close());

describe('health endpoint', () => {
  it('returns the shared health response shape', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '127.0.0.1:4317' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      gh: { authenticated: true, login: 'octocat' },
      llm: {
        configured: true,
        provider: 'openrouter',
        model: 'openrouter/free',
      },
      poller: { enabled: true },
    });
    expect(response.body).not.toContain('set-but-never-returned');
  });

  it('rejects non-local Host headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'example.com' },
    });
    expect(response.statusCode).toBe(403);
  });
});
