import type { FastifyInstance } from 'fastify';
import { ApiErrorSchema, ApiSchemas } from '@pr-reviewer/shared';
import { GhAuthError, GhRateLimitError } from '../gh/errors.js';
import { InboxService } from '../inbox/index.js';

export function registerInboxRoutes(app: FastifyInstance, inbox: InboxService) {
  app.get('/api/inbox', async (_request, reply) => {
    try {
      return reply.send(ApiSchemas.inbox.response.parse(await inbox.list()));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Inbox refresh failed';
      if (error instanceof GhAuthError)
        return reply.code(401).send(
          ApiErrorSchema.parse({
            error: { code: 'GH_NOT_AUTHENTICATED', message },
          }),
        );
      if (error instanceof GhRateLimitError)
        return reply
          .code(429)
          .send(
            ApiErrorSchema.parse({
              error: { code: 'GH_RATE_LIMITED', message },
            }),
          );
      return reply
        .code(500)
        .send(ApiErrorSchema.parse({ error: { code: 'INTERNAL', message } }));
    }
  });
}
