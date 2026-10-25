import Fastify from 'fastify';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HealthResponseSchema } from '@pr-reviewer/shared';

export function createServer() {
  const app = Fastify({ logger: true });
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host?.split(':')[0]?.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost') {
      return reply.code(403).send({ error: { code: 'INTERNAL', message: 'Host not allowed' } });
    }
  });
  app.get('/api/health', async (_request, reply) => reply.send(HealthResponseSchema.parse({
    gh: { authenticated: false, error: 'GitHub status check is not configured yet' },
    llm: { configured: Boolean(process.env.ANTHROPIC_API_KEY), provider: 'anthropic', model: 'claude-sonnet-5-5' },
    poller: { enabled: false }, version: '0.1.0',
  })));
  return app;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  const port = Number(process.env.PORT ?? 4317);
  createServer().listen({ port, host: '127.0.0.1' }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
