import type { FastifyInstance, FastifyReply } from 'fastify';
import { ApiErrorSchema, ApiSchemas } from '@pr-reviewer/shared';
import {
  GhAuthError,
  GhNotFoundError,
  GhRateLimitError,
} from '../gh/errors.js';
import { LlmNotConfiguredError } from '../llm/provider.js';
import {
  HeadMovedError,
  PendingExistsError,
  PublishService,
} from '../publish/index.js';
import {
  ReviewNotFoundError,
  ReviewService,
  ReviewStateError,
} from '../review/index.js';

const apiError = (code: string, message: string, details?: unknown) =>
  ApiErrorSchema.parse({
    error: { code, message, ...(details === undefined ? {} : { details }) },
  });

function sendError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'Internal error';
  if (error instanceof ReviewNotFoundError || error instanceof GhNotFoundError)
    return reply.code(404).send(apiError('GH_NOT_FOUND', message));
  if (error instanceof ReviewStateError)
    return reply.code(409).send(apiError('INVALID_STATE', message));
  if (error instanceof HeadMovedError)
    return reply
      .code(409)
      .send(
        apiError('HEAD_MOVED', message, {
          currentHeadSha: error.currentHeadSha,
        }),
      );
  if (error instanceof PendingExistsError)
    return reply.code(409).send(
      apiError('PENDING_EXISTS', message, {
        reviewId: error.reviewId,
        ...(error.reviewUrl ? { reviewUrl: error.reviewUrl } : {}),
      }),
    );
  if (error instanceof GhAuthError)
    return reply.code(401).send(apiError('GH_NOT_AUTHENTICATED', message));
  if (error instanceof GhRateLimitError)
    return reply.code(429).send(apiError('GH_RATE_LIMITED', message));
  if (error instanceof LlmNotConfiguredError)
    return reply.code(503).send(apiError('LLM_NOT_CONFIGURED', message));
  if (/rules.*invalid/i.test(message))
    return reply.code(422).send(apiError('RULES_INVALID', message));
  if (/rules.*disabled|ENOENT|no such file/i.test(message))
    return reply.code(404).send(apiError('NO_RULES', message));
  if (/PR URL|absolute GitHub URL/i.test(message))
    return reply.code(400).send(apiError('VALIDATION_ERROR', message));
  return reply.code(500).send(apiError('INTERNAL', message));
}

export function registerReviewRoutes(
  app: FastifyInstance,
  reviews: ReviewService,
  publisher?: PublishService,
) {
  app.get('/api/reviews', async (request, reply) => {
    const query = ApiSchemas.reviews.listQuery.safeParse(request.query);
    if (!query.success)
      return reply
        .code(400)
        .send(
          apiError(
            'VALIDATION_ERROR',
            'Invalid review filters',
            query.error.flatten(),
          ),
        );
    const { status, repo, limit, cursor } = query.data;
    return reply.send(
      ApiSchemas.reviews.list.parse(
        reviews.list({
          ...(status ? { status } : {}),
          ...(repo ? { repo } : {}),
          ...(limit ? { limit } : {}),
          ...(cursor ? { cursor } : {}),
        }),
      ),
    );
  });

  app.post('/api/reviews', async (request, reply) => {
    const body = ApiSchemas.reviews.create.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiError('VALIDATION_ERROR', 'Invalid PR URL'));
    try {
      return reply.send(
        ApiSchemas.reviews.summary.parse(
          await reviews.enqueue(body.data.prUrl),
        ),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/reviews/:id',
    async (request, reply) => {
      try {
        return reply.send(
          ApiSchemas.reviews.detail.parse(reviews.get(request.params.id)),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/reviews/:id/diff',
    async (request, reply) => {
      try {
        return reply.send(
          ApiSchemas.reviews.diff.parse(reviews.getDiff(request.params.id)),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/reviews/:id',
    async (request, reply) => {
      const body = ApiSchemas.reviews.edit.safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .send(apiError('VALIDATION_ERROR', 'Invalid review edit'));
      try {
        return reply.send(
          ApiSchemas.reviews.detail.parse(
            await reviews.edit(request.params.id, {
              ...(body.data.summary !== undefined
                ? { summary: body.data.summary }
                : {}),
              ...(body.data.verdict !== undefined
                ? { verdict: body.data.verdict }
                : {}),
            }),
          ),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/reviews/:id/comments',
    async (request, reply) => {
      const body = ApiSchemas.reviews.addComment.safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .send(apiError('VALIDATION_ERROR', 'Invalid comment'));
      try {
        return reply.send(
          await reviews.addComment(request.params.id, body.data),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.patch<{ Params: { id: string; cid: string } }>(
    '/api/reviews/:id/comments/:cid',
    async (request, reply) => {
      const body = ApiSchemas.reviews.editComment.safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .send(apiError('VALIDATION_ERROR', 'Invalid comment edit'));
      try {
        return reply.send(
          await reviews.editComment(request.params.id, request.params.cid, {
            ...(body.data.body !== undefined ? { body: body.data.body } : {}),
            ...(body.data.severity !== undefined
              ? { severity: body.data.severity }
              : {}),
            ...(body.data.included !== undefined
              ? { included: body.data.included }
              : {}),
            ...(body.data.suggestion !== undefined
              ? { suggestion: body.data.suggestion }
              : {}),
          }),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.delete<{ Params: { id: string; cid: string } }>(
    '/api/reviews/:id/comments/:cid',
    async (request, reply) => {
      try {
        await reviews.deleteComment(request.params.id, request.params.cid);
        return reply.code(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/reviews/:id/publish',
    async (request, reply) => {
      const body = ApiSchemas.reviews.publish.safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .send(apiError('VALIDATION_ERROR', 'Invalid publish request'));
      if (!publisher)
        return reply
          .code(503)
          .send(apiError('INTERNAL', 'Publishing is not configured'));
      try {
        return reply.send(
          ApiSchemas.reviews.publishResponse.parse(
            await publisher.publish(request.params.id, {
              mode: body.data.mode,
              ...(body.data.event ? { event: body.data.event } : {}),
              ...(body.data.force !== undefined
                ? { force: body.data.force }
                : {}),
              ...(body.data.replacePending !== undefined
                ? { replacePending: body.data.replacePending }
                : {}),
            }),
          ),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/reviews/:id/rerun',
    async (request, reply) => {
      try {
        return reply.send(
          ApiSchemas.reviews.summary.parse(
            await reviews.rerun(request.params.id),
          ),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/reviews/:id/dismiss',
    async (request, reply) => {
      try {
        const detail = await reviews.dismiss(request.params.id);
        return reply.send(ApiSchemas.reviews.summary.parse(detail));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
