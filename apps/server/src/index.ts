import Fastify from 'fastify';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppConfigSchema, HealthResponseSchema } from '@pr-reviewer/shared';
import type { AppConfig } from '@pr-reviewer/shared';
import { initializeConfig, isLlmConfigured, resolveDataPaths } from './config/index.js';
import type { DataPaths } from './config/index.js';
import { createGhClient, type GhClient } from './gh/client.js';
import { registerProjectRoutes } from './api/projects.js';
import { registerReviewRoutes } from './api/reviews.js';
import { ReviewDatabase } from './db/index.js';
import { createReviewProvider } from './llm/index.js';
import { ReviewService } from './review/index.js';

export type ServerOptions = { config?: AppConfig; paths?: DataPaths; gh?: GhClient; env?: NodeJS.ProcessEnv; version?: string; reviews?: ReviewService };

export function createServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: true });
  const config = options.config ?? AppConfigSchema.parse({});
  const paths = options.paths ?? resolveDataPaths();
  const gh = options.gh ?? createGhClient();
  const env = options.env ?? process.env;
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host?.split(':')[0]?.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost') {
      return reply.code(403).send({ error: { code: 'INTERNAL', message: 'Host not allowed' } });
    }
  });
  app.get('/api/health', async (_request, reply) => {
    let ghStatus: { authenticated: boolean; login?: string; error?: string };
    try {
      const auth = await gh.authStatus();
      ghStatus = { authenticated: true, login: auth.login };
    } catch (error) {
      ghStatus = { authenticated: false, error: error instanceof Error ? error.message : 'GitHub status check failed' };
    }
    return reply.send(HealthResponseSchema.parse({
      gh: ghStatus,
      llm: { configured: isLlmConfigured(config, env), provider: config.llm.provider, model: config.llm.model },
      poller: { enabled: config.poller.enabled },
      version: options.version ?? '0.1.0',
    }));
  });
  registerProjectRoutes(app, paths);
  if (options.reviews) registerReviewRoutes(app, options.reviews);
  return app;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  initializeConfig()
    .then(async ({ paths, config }) => {
      const gh = createGhClient();
      const database = await ReviewDatabase.open(paths.database);
      const recovered = await database.recoverInterruptedReviews();
      if (recovered > 0)
        console.warn(`Recovered ${recovered} interrupted review(s)`);
      const reviews = new ReviewService(
        database,
        gh,
        createReviewProvider(config),
        paths,
        config,
      );
      const app = createServer({ paths, config, gh, reviews });
      app.addHook('onClose', () => database.close());
      return app.listen({ port: config.server.port, host: '127.0.0.1' });
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
