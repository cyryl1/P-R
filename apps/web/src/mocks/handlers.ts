import { ErrorCodeSchema, type ErrorCode } from '@pr-reviewer/shared';
import { http, HttpResponse, type HttpHandler } from 'msw';
import * as f from './fixtures';

/**
 * Force any endpoint to fail with a given code: send an `x-mock-error: <CODE>` header,
 * or open the app with `?mockError=<CODE>` in the URL.
 */
function forcedError(request: Request): ErrorCode | undefined {
  const raw =
    request.headers.get('x-mock-error') ??
    (typeof location !== 'undefined'
      ? new URLSearchParams(location.search).get('mockError')
      : null);
  const parsed = ErrorCodeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function errorResponse(code: ErrorCode) {
  const { status, message, details } = f.errorResponses[code];
  return HttpResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

function route(
  handler: (args: {
    request: Request;
    params: Record<string, string | readonly string[] | undefined>;
  }) => Response | Promise<Response>,
) {
  return async (args: {
    request: Request;
    params: Record<string, string | readonly string[] | undefined>;
  }) => {
    const code = forcedError(args.request);
    return code ? errorResponse(code) : handler(args);
  };
}

const repoOf = (
  params: Record<string, string | readonly string[] | undefined>,
) => `${params.owner}/${params.repo}`;
const statusOf = (id: string) => f.reviewSummaries.find((r) => r.id === id);

export const handlers: HttpHandler[] = [
  http.get(
    '/api/health',
    route(() => HttpResponse.json(f.healthOk)),
  ),
  http.get(
    '/api/settings',
    route(() => HttpResponse.json(f.settings)),
  ),
  http.put(
    '/api/settings',
    route(async ({ request }) =>
      HttpResponse.json({
        ...f.settings,
        ...((await request.json()) as object),
      }),
    ),
  ),
  http.get(
    '/api/inbox',
    route(() => HttpResponse.json(f.inbox)),
  ),
  http.post(
    '/api/poll',
    route(() => HttpResponse.json({ started: true })),
  ),

  http.get(
    '/api/projects',
    route(() => HttpResponse.json(f.projects)),
  ),
  // Literal paths must come before /projects/:owner/:repo.
  http.post(
    '/api/projects/validate',
    route(async ({ request }) => {
      const { yaml } = (await request.json()) as { yaml: string };
      const invalid = /limit:\s*lots/.test(yaml);
      return HttpResponse.json(
        invalid
          ? {
              valid: false,
              errors: [
                {
                  path: 'rules[0].limit',
                  message: 'expected number',
                  line: 6,
                  column: 12,
                },
              ],
            }
          : { valid: true, errors: [] },
      );
    }),
  ),
  http.get(
    '/api/projects/template',
    route(({ request }) => {
      const repo =
        new URL(request.url).searchParams.get('repo') ?? 'owner/repo';
      return HttpResponse.json({
        yaml: f.validYaml.replace('acme/payments-api', repo),
      });
    }),
  ),
  http.get(
    '/api/projects/:owner/:repo',
    route(({ params }) => {
      const repo = repoOf(params);
      return f.projects.some((p) => p.repo === repo)
        ? HttpResponse.json(f.projectDocument(repo))
        : errorResponse('NO_RULES');
    }),
  ),
  http.put(
    '/api/projects/:owner/:repo',
    route(async ({ request, params }) => {
      const { yaml } = (await request.json()) as { yaml: string };
      if (/limit:\s*lots/.test(yaml)) return errorResponse('RULES_INVALID');
      return HttpResponse.json({
        repo: repoOf(params),
        yaml,
        valid: true,
        errors: [],
      });
    }),
  ),
  http.delete(
    '/api/projects/:owner/:repo',
    route(() => new HttpResponse(null, { status: 204 })),
  ),

  http.get(
    '/api/reviews',
    route(({ request }) => {
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const repo = url.searchParams.get('repo');
      const items = f.reviewSummaries.filter(
        (r) => (!status || r.status === status) && (!repo || r.repo === repo),
      );
      return HttpResponse.json({ items });
    }),
  ),
  http.post(
    '/api/reviews',
    route(() =>
      HttpResponse.json(
        f.reviewSummary('queued', { id: 'rev_new', trigger: 'manual' }),
      ),
    ),
  ),
  http.get(
    '/api/reviews/:id',
    route(({ params }) => {
      const summary = statusOf(String(params.id));
      return summary
        ? HttpResponse.json(f.reviewDetail(summary.status))
        : errorResponse('GH_NOT_FOUND');
    }),
  ),
  http.get(
    '/api/reviews/:id/diff',
    route(() => HttpResponse.json(f.diffFiles)),
  ),
  http.patch(
    '/api/reviews/:id',
    route(async ({ request, params }) => {
      const summary = statusOf(String(params.id));
      if (!summary) return errorResponse('GH_NOT_FOUND');
      if (summary.status !== 'draft_ready' && summary.status !== 'stale')
        return errorResponse('INVALID_STATE');
      return HttpResponse.json({
        ...f.reviewDetail(summary.status),
        ...((await request.json()) as object),
      });
    }),
  ),
  http.post(
    '/api/reviews/:id/comments',
    route(async ({ request }) => {
      const body = (await request.json()) as object;
      return HttpResponse.json({
        id: 'c_new',
        source: 'user',
        included: true,
        anchorStatus: 'valid',
        ...body,
      });
    }),
  ),
  http.patch(
    '/api/reviews/:id/comments/:cid',
    route(async ({ request, params }) => {
      const existing = f.comments.find((c) => c.id === params.cid);
      return existing
        ? HttpResponse.json({
            ...existing,
            ...((await request.json()) as object),
          })
        : errorResponse('GH_NOT_FOUND');
    }),
  ),
  http.delete(
    '/api/reviews/:id/comments/:cid',
    route(() => new HttpResponse(null, { status: 204 })),
  ),
  http.post(
    '/api/reviews/:id/rerun',
    route(() =>
      HttpResponse.json(
        f.reviewSummary('queued', { id: 'rev_rerun', trigger: 'rerun' }),
      ),
    ),
  ),
  http.post(
    '/api/reviews/:id/dismiss',
    route(({ params }) =>
      HttpResponse.json({
        ...(statusOf(String(params.id)) ?? f.reviewSummary('draft_ready')),
        status: 'dismissed',
      }),
    ),
  ),
  http.post(
    '/api/reviews/:id/publish',
    route(async ({ request }) => {
      const { mode } = (await request.json()) as { mode: 'pending' | 'submit' };
      return HttpResponse.json({
        status: mode === 'submit' ? 'submitted' : 'published_pending',
        githubReviewUrl:
          'https://github.com/acme/payments-api/pull/128#pullrequestreview-987654',
        publishedComments: 2,
        foldedIntoSummary: 1,
      });
    }),
  ),

  http.get(
    '/api/activity',
    route(() => HttpResponse.json({ items: f.activity })),
  ),
];
