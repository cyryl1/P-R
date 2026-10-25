import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from './index.js';

const app = createServer();
afterAll(async () => app.close());

describe('health endpoint', () => {
  it('returns the shared health response shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:4317' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ gh: { authenticated: false }, llm: { provider: 'anthropic' }, poller: { enabled: false } });
  });
});
