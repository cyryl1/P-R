import type { FastifyInstance } from 'fastify';
import { ApiSchemas } from '@pr-reviewer/shared';
import { Poller } from '../poller/index.js';

export function registerPollRoutes(app: FastifyInstance, poller: Poller) {
  app.post('/api/poll', async (_request, reply) => {
    void poller.pollNow();
    return reply.send(ApiSchemas.poll.response.parse({ started: true }));
  });
}
