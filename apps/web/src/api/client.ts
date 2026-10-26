import {
  ApiErrorSchema,
  ApiSchemas,
  type AppConfig,
  type ErrorCode,
  type HealthResponse,
  type InboxItem,
  type ReviewComment,
  type ReviewDetail,
  type ReviewSummary,
} from '@pr-reviewer/shared';
import type { z } from 'zod';
import type {
  ActivityList,
  AddCommentBody,
  DiffFile,
  EditCommentBody,
  EditReviewBody,
  ProjectSummary,
  PublishBody,
  PublishResponse,
  ReviewList,
  ReviewListQuery,
  RulesDocument,
  SettingsUpdate,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | 'NETWORK',
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(
  method: Method,
  path: string,
  opts: {
    body?: unknown;
    query?: Record<string, unknown>;
    schema?: z.ZodType<T, z.ZodTypeDef, unknown>;
  } = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.size > 0 ? `?${params}` : '';
  let res: Response;
  try {
    const init: RequestInit = { method };
    if (opts.body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    res = await fetch(`/api${path}${qs}`, init);
  } catch (cause) {
    throw new ApiError(
      'NETWORK',
      cause instanceof Error ? cause.message : 'Network error',
      0,
    );
  }

  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(
      await res.json().catch(() => undefined),
    );
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(code, message, res.status, details);
    }
    throw new ApiError(
      'INTERNAL',
      `Request failed (${res.status})`,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return opts.schema ? opts.schema.parse(json) : (json as T);
}

const repoPath = (repo: string) => `/projects/${repo}`;

export const api = {
  health: () =>
    request<HealthResponse>('GET', '/health', {
      schema: ApiSchemas.health.response,
    }),
  settings: () =>
    request<AppConfig>('GET', '/settings', {
      schema: ApiSchemas.settings.response,
    }),
  updateSettings: (body: SettingsUpdate) =>
    request<AppConfig>('PUT', '/settings', {
      body,
      schema: ApiSchemas.settings.response,
    }),
  inbox: () =>
    request<InboxItem[]>('GET', '/inbox', {
      schema: ApiSchemas.inbox.response,
    }),
  poll: () =>
    request<{ started: true }>('POST', '/poll', {
      schema: ApiSchemas.poll.response,
    }),

  projects: () =>
    request<ProjectSummary[]>('GET', '/projects', {
      schema: ApiSchemas.projects.response,
    }),
  project: (repo: string) =>
    request<RulesDocument>('GET', repoPath(repo), {
      schema: ApiSchemas.projects.document,
    }),
  saveProject: (repo: string, yaml: string) =>
    request<RulesDocument>('PUT', repoPath(repo), {
      body: { yaml },
      schema: ApiSchemas.projects.document,
    }),
  deleteProject: (repo: string) => request<void>('DELETE', repoPath(repo)),
  validateProject: (yaml: string) =>
    request<{ valid: boolean; errors: RulesDocument['errors'] }>(
      'POST',
      '/projects/validate',
      { body: { yaml } },
    ),
  projectTemplate: (repo: string) =>
    request<{ yaml: string }>('GET', '/projects/template', { query: { repo } }),

  reviews: (query: ReviewListQuery = {}) =>
    request<ReviewList>('GET', '/reviews', {
      query,
      schema: ApiSchemas.reviews.list,
    }),
  createReview: (prUrl: string) =>
    request<ReviewSummary>('POST', '/reviews', {
      body: { prUrl },
      schema: ApiSchemas.reviews.summary,
    }),
  review: (id: string) =>
    request<ReviewDetail>('GET', `/reviews/${id}`, {
      schema: ApiSchemas.reviews.detail,
    }),
  reviewDiff: (id: string) =>
    request<DiffFile[]>('GET', `/reviews/${id}/diff`, {
      schema: ApiSchemas.reviews.diff,
    }),
  editReview: (id: string, body: EditReviewBody) =>
    request<ReviewDetail>('PATCH', `/reviews/${id}`, {
      body,
      schema: ApiSchemas.reviews.detail,
    }),
  addComment: (id: string, body: AddCommentBody) =>
    request<ReviewComment>('POST', `/reviews/${id}/comments`, { body }),
  editComment: (id: string, cid: string, body: EditCommentBody) =>
    request<ReviewComment>('PATCH', `/reviews/${id}/comments/${cid}`, { body }),
  deleteComment: (id: string, cid: string) =>
    request<void>('DELETE', `/reviews/${id}/comments/${cid}`),
  rerunReview: (id: string) =>
    request<ReviewSummary>('POST', `/reviews/${id}/rerun`, {
      schema: ApiSchemas.reviews.summary,
    }),
  dismissReview: (id: string) =>
    request<ReviewSummary>('POST', `/reviews/${id}/dismiss`, {
      schema: ApiSchemas.reviews.summary,
    }),
  publishReview: (id: string, body: PublishBody) =>
    request<PublishResponse>('POST', `/reviews/${id}/publish`, {
      body,
      schema: ApiSchemas.reviews.publishResponse,
    }),

  activity: (query: { limit?: number; cursor?: string } = {}) =>
    request<ActivityList>('GET', '/activity', {
      query,
      schema: ApiSchemas.activity.response,
    }),
};
