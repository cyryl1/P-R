import { execa } from 'execa';
import { mapGhError } from './errors.js';

export type GhAuthStatus = { login: string };
export type GhSearchResult = {
  number: number;
  title: string;
  repository: { nameWithOwner: string };
  url: string;
  author: { login: string };
  isDraft: boolean;
  updatedAt: string;
};
export type GhPr = {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  url: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    changeType?: string;
  }>;
  closingIssuesReferences: Array<{ number: number; url: string }>;
  state: string;
};
export type GhReview = {
  id: number;
  state: string;
  body?: string | null;
  html_url?: string;
  user?: { login: string } | null;
  submitted_at?: string | null;
};
export type GhReviewPayload = {
  commit_id: string;
  body: string;
  event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments: Array<{
    path: string;
    line: number;
    side: 'RIGHT' | 'LEFT';
    body: string;
  }>;
};

export interface GhClient {
  authStatus(): Promise<GhAuthStatus>;
  searchReviewRequests(options?: {
    teams?: boolean;
  }): Promise<GhSearchResult[]>;
  getPr(repo: string, number: number): Promise<GhPr>;
  getDiff(repo: string, number: number): Promise<string>;
  getFile(repo: string, path: string, ref: string): Promise<string>;
  listReviews(repo: string, number: number): Promise<GhReview[]>;
  createReview(
    repo: string,
    number: number,
    payload: GhReviewPayload,
  ): Promise<GhReview>;
  submitReview(
    repo: string,
    number: number,
    id: string | number,
    event: string,
    body?: string,
  ): Promise<GhReview>;
  deletePendingReview(
    repo: string,
    number: number,
    id: string | number,
  ): Promise<void>;
}

export type GhRun = (
  args: string[],
  options?: { input?: string; timeoutMs?: number },
) => Promise<string>;

export const runGh: GhRun = async (args, options = {}) => {
  try {
    const result = await execa('gh', args, {
      ...(options.input === undefined ? {} : { input: options.input }),
      timeout: options.timeoutMs ?? 30_000,
      reject: true,
    });
    return result.stdout;
  } catch (error) {
    throw mapGhError(error);
  }
};

const parseJson = <T>(raw: string): T => JSON.parse(raw) as T;
const repoArg = (repo: string): string => {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo))
    throw new Error(`Invalid repository: ${repo}`);
  return repo;
};

export function createGhClient(run: GhRun = runGh): GhClient {
  const api = (args: string[], input?: string) =>
    run(['api', ...args], input === undefined ? undefined : { input });
  return {
    async authStatus() {
      await run(['auth', 'status']);
      const login = (await run(['api', 'user', '--jq', '.login'])).trim();
      return { login };
    },
    async searchReviewRequests({ teams = false } = {}) {
      const reviewQuery = teams
        ? '--review-requested=@me'
        : 'user-review-requested:@me';
      const raw = await run([
        'search',
        'prs',
        reviewQuery,
        '--state=open',
        '--json',
        'number,title,repository,url,author,isDraft,updatedAt',
        '--limit',
        '100',
      ]);
      return parseJson<GhSearchResult[]>(raw);
    },
    async getPr(repo, number) {
      const raw = await run([
        'pr',
        'view',
        String(number),
        '-R',
        repoArg(repo),
        '--json',
        'number,title,body,author,url,baseRefName,headRefName,headRefOid,isDraft,additions,deletions,files,closingIssuesReferences,state',
      ]);
      return parseJson<GhPr>(raw);
    },
    getDiff: (repo, number) =>
      run(['pr', 'diff', String(number), '-R', repoArg(repo)]),
    async getFile(repo, path, ref) {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      return run([
        'api',
        `repos/${repoArg(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
        '-H',
        'Accept: application/vnd.github.raw',
      ]);
    },
    async listReviews(repo, number) {
      const raw = await api([
        `repos/${repoArg(repo)}/pulls/${number}/reviews`,
        '--paginate',
        '--slurp',
      ]);
      return parseJson<GhReview[][]>(raw).flat();
    },
    async createReview(repo, number, payload) {
      return parseJson<GhReview>(
        await run(
          [
            'api',
            `repos/${repoArg(repo)}/pulls/${number}/reviews`,
            '-X',
            'POST',
            '--input',
            '-',
          ],
          { input: JSON.stringify(payload) },
        ),
      );
    },
    async submitReview(repo, number, id, event, body) {
      return parseJson<GhReview>(
        await run(
          [
            'api',
            `repos/${repoArg(repo)}/pulls/${number}/reviews/${id}/events`,
            '-X',
            'POST',
            '--input',
            '-',
          ],
          { input: JSON.stringify({ event, body }) },
        ),
      );
    },
    async deletePendingReview(repo, number, id) {
      await run([
        'api',
        `repos/${repoArg(repo)}/pulls/${number}/reviews/${id}`,
        '-X',
        'DELETE',
      ]);
    },
  };
}
