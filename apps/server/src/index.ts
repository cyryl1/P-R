import Fastify from 'fastify';
import type { FastifyBaseLogger } from 'fastify';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppConfigSchema, HealthResponseSchema } from '@pr-reviewer/shared';
import type { AppConfig } from '@pr-reviewer/shared';
import {
  initializeConfig,
  isLlmConfigured,
  resolveDataPaths,
} from './config/index.js';
import type { DataPaths } from './config/index.js';
import { createGhClient, type GhClient } from './gh/client.js';
import { registerProjectRoutes } from './api/projects.js';
import { registerReviewRoutes } from './api/reviews.js';
import { registerInboxRoutes } from './api/inbox.js';
import { registerSettingsRoutes, SettingsService } from './api/settings.js';
import { registerActivityRoutes } from './api/activity.js';
import { registerEventRoutes } from './api/events.js';
import { registerPollRoutes } from './api/poll.js';
import { ReviewDatabase } from './db/index.js';
import { createReviewProvider } from './llm/index.js';
import { ReviewService } from './review/index.js';
import { PublishService } from './publish/index.js';
import { InboxService } from './inbox/index.js';
import { EventHub } from './events/index.js';
import { JobQueue } from './jobs/index.js';
import { Poller } from './poller/index.js';
import { createFileLogger } from './logging/index.js';
import { registerProductionWeb } from './static/index.js';

export type ServerOptions = {
  config?: AppConfig;
  paths?: DataPaths;
  gh?: GhClient;
  env?: NodeJS.ProcessEnv;
  version?: string;
  reviews?: ReviewService;
  publisher?: PublishService;
  inbox?: InboxService;
  events?: EventHub;
  jobs?: JobQueue;
  poller?: Poller;
  loggerInstance?: FastifyBaseLogger;
  logger?: boolean;
  production?: boolean;
  webDist?: string;
};

export function createServer(options: ServerOptions = {}) {
  const app = options.loggerInstance
    ? Fastify({ loggerInstance: options.loggerInstance })
    : Fastify({ logger: options.logger ?? true });
  let config = options.config ?? AppConfigSchema.parse({});
  const paths = options.paths ?? resolveDataPaths();
  const gh = options.gh ?? createGhClient();
  const env = options.env ?? process.env;
  const events = options.events ?? new EventHub();
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host?.split(':')[0]?.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost') {
      return reply
        .code(403)
        .send({ error: { code: 'INTERNAL', message: 'Host not allowed' } });
    }
  });
  app.get('/api/health', async (_request, reply) => {
    const pollStatus = options.poller?.getStatus();
    let ghStatus: { authenticated: boolean; login?: string; error?: string };
    try {
      const auth = await gh.authStatus();
      ghStatus = { authenticated: true, login: auth.login };
    } catch (error) {
      ghStatus = {
        authenticated: false,
        error:
          error instanceof Error ? error.message : 'GitHub status check failed',
      };
    }
    return reply.send(
      HealthResponseSchema.parse({
        gh: ghStatus,
        llm: {
          configured: isLlmConfigured(config, env),
          provider: config.llm.provider,
          model: config.llm.model,
        },
        poller: {
          enabled: config.poller.enabled,
          ...(pollStatus?.lastRunAt ? { lastRunAt: pollStatus.lastRunAt } : {}),
          ...(pollStatus?.nextRunAt ? { nextRunAt: pollStatus.nextRunAt } : {}),
          ...(pollStatus?.lastError ? { lastError: pollStatus.lastError } : {}),
        },
        version: options.version ?? '0.1.0',
      }),
    );
  });
  registerProjectRoutes(app, paths);
  registerEventRoutes(app, events);
  const settings = new SettingsService(paths, config, (updated) => {
    config = updated;
    options.reviews?.configure(updated, env);
    options.jobs?.configure(updated);
    options.poller?.configure(updated);
  });
  registerSettingsRoutes(app, settings);
  if (options.reviews) {
    options.reviews.database.setEventSink((event) => events.publish(event));
    const publisher =
      options.publisher ?? new PublishService(options.reviews.database, gh);
    const inbox =
      options.inbox ?? new InboxService(options.reviews.database, gh, paths);
    registerReviewRoutes(app, options.reviews, publisher);
    registerInboxRoutes(app, inbox);
    registerActivityRoutes(app, options.reviews.database);
  }
  if (options.poller) registerPollRoutes(app, options.poller);
  if (options.production)
    registerProductionWeb(
      app,
      options.webDist ??
        resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist'),
    );
  return app;
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
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
      const events = new EventHub();
      const jobs = new JobQueue(database, reviews, config);
      reviews.setQueue(jobs);
      const poller = new Poller(database, gh, reviews, paths, events, config);
      const production =
        process.argv.includes('--production') ||
        process.env.NODE_ENV === 'production';
      const app = createServer({
        paths,
        config,
        gh,
        reviews,
        events,
        jobs,
        poller,
        production,
        loggerInstance: createFileLogger(paths.logs),
      });
      await jobs.start();
      poller.start();
      app.addHook('onClose', async () => {
        await poller.stop();
        await jobs.stop();
        database.close();
      });
      return app.listen({ port: config.server.port, host: '127.0.0.1' });
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
