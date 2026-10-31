import type { FastifyInstance } from 'fastify';
import { ApiErrorSchema, ApiSchemas } from '@pr-reviewer/shared';
import { ReviewDatabase } from '../db/index.js';

export function registerActivityRoutes(
  app: FastifyInstance,
  database: ReviewDatabase,
) {
  app.get('/api/activity', async (request, reply) => {
    const query = ApiSchemas.activity.query.safeParse(request.query);
    if (!query.success)
      return reply.code(400).send(
        ApiErrorSchema.parse({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid activity filters',
            details: query.error.flatten(),
          },
        }),
      );
    return reply.send(
      ApiSchemas.activity.response.parse(
        database.listActivities({
          ...(query.data.limit ? { limit: query.data.limit } : {}),
          ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
        }),
      ),
    );
  });
}
