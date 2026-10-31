import { createRequire } from 'node:module';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { ulid } from 'ulid';
import {
  ActivityEntrySchema,
  ReviewCommentSchema,
  ReviewDetailSchema,
  ReviewSummarySchema,
  type ReviewComment,
  type ActivityEntry,
  type ReviewDetail,
  type ReviewStatus,
  type ReviewSummary,
  type ReviewTrigger,
  type RulesFile,
  type ServerEvent,
  type Severity,
  type Verdict,
} from '@pr-reviewer/shared';
import type { DiffFile } from '../diff/index.js';
import type { GhPr } from '../gh/client.js';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');

type Row = Record<string, SqlValue>;
type ReviewPatch = {
  status?: ReviewStatus;
  summary?: string;
  verdict?: Verdict;
  ruleResults?: unknown[];
  llmMeta?: unknown;
  diff?: DiffFile[];
  error?: string | null;
  githubReviewId?: string | null;
  githubReviewUrl?: string | null;
  publishedAt?: string | null;
};

export type NewComment = Omit<ReviewComment, 'id'>;
export type InboxPr = {
  id: number;
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  headSha: string;
  isDraft: boolean;
  updatedAt: string;
};
export type ReviewJob = {
  id: string;
  reviewId: string;
  prId: number;
  status: 'queued' | 'running' | 'retry_wait' | 'done' | 'failed';
  attempts: number;
  availableAt: string;
  lastError?: string;
};

const migrations = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS prs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  url TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  is_draft INTEGER NOT NULL,
  additions INTEGER NOT NULL,
  deletions INTEGER NOT NULL,
  review_requested INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(repo, number)
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  pr_id INTEGER NOT NULL REFERENCES prs(id),
  head_sha TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  verdict TEXT NOT NULL DEFAULT 'COMMENT',
  rule_results TEXT NOT NULL DEFAULT '[]',
  rules_snapshot TEXT NOT NULL,
  llm_meta TEXT,
  diff_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  github_review_id TEXT,
  github_review_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS reviews_pr_created ON reviews(pr_id, created_at DESC);
CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  side TEXT NOT NULL,
  severity TEXT NOT NULL,
  rule_id TEXT,
  body TEXT NOT NULL,
  suggestion TEXT,
  source TEXT NOT NULL,
  included INTEGER NOT NULL,
  anchor_status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  review_id TEXT,
  pr_id INTEGER
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
  pr_id INTEGER NOT NULL REFERENCES prs(id),
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_available ON jobs(status, available_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_pr ON jobs(pr_id)
  WHERE status IN ('queued', 'running', 'retry_wait');
PRAGMA user_version = 2;
`;

function asString(value: SqlValue | undefined): string {
  if (value === undefined)
    throw new Error('Database row is missing a required value');
  return String(value);
}

function optionalString(value: SqlValue | undefined): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

export class ReviewDatabase {
  private eventSink: ((event: ServerEvent) => void) | undefined;
  private persistence: Promise<void> = Promise.resolve();

  private constructor(
    private readonly database: Database,
    private readonly path: string,
  ) {}

  static async open(path: string): Promise<ReviewDatabase> {
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    let bytes: Uint8Array | undefined;
    if (path !== ':memory:') {
      try {
        bytes = new Uint8Array(await readFile(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const store = new ReviewDatabase(new SQL.Database(bytes), path);
    store.database.run(migrations);
    await store.persist();
    return store;
  }

  close() {
    this.database.close();
  }

  setEventSink(sink: ((event: ServerEvent) => void) | undefined) {
    this.eventSink = sink;
  }

  async recoverInterruptedReviews(): Promise<number> {
    const now = new Date().toISOString();
    this.database.run(
      `UPDATE reviews
       SET status='failed',
           error='Server restarted while publishing; verify GitHub before retrying.',
           updated_at=?
       WHERE status='publishing'`,
      [now],
    );
    const recovered = this.database.getRowsModified();
    if (recovered > 0) await this.persist();
    return recovered;
  }

  private all(sql: string, parameters: SqlValue[] = []): Row[] {
    const statement = this.database.prepare(sql);
    try {
      statement.bind(parameters);
      const rows: Row[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  private one(sql: string, parameters: SqlValue[] = []): Row | undefined {
    return this.all(sql, parameters)[0];
  }

  private async persist() {
    if (this.path === ':memory:') return;
    const bytes = this.database.export();
    const operation = this.persistence
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, this.path);
      });
    this.persistence = operation;
    await operation;
  }

  async upsertPr(
    repo: string,
    pr: GhPr,
    options: { reviewRequested?: boolean } = {},
  ): Promise<number> {
    const now = new Date().toISOString();
    this.database.run(
      `INSERT INTO prs
       (repo, number, title, body, author, url, head_sha, base_ref, head_ref,
        is_draft, additions, deletions, review_requested, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo, number) DO UPDATE SET
         title=excluded.title, body=excluded.body, author=excluded.author,
         url=excluded.url, head_sha=excluded.head_sha, base_ref=excluded.base_ref,
         head_ref=excluded.head_ref, is_draft=excluded.is_draft,
         additions=excluded.additions, deletions=excluded.deletions,
         review_requested=CASE WHEN ? IS NULL THEN prs.review_requested ELSE excluded.review_requested END,
         last_seen_at=excluded.last_seen_at`,
      [
        repo,
        pr.number,
        pr.title,
        pr.body,
        pr.author.login,
        pr.url,
        pr.headRefOid,
        pr.baseRefName,
        pr.headRefName,
        pr.isDraft ? 1 : 0,
        pr.additions,
        pr.deletions,
        options.reviewRequested === undefined
          ? 0
          : options.reviewRequested
            ? 1
            : 0,
        now,
        now,
        options.reviewRequested === undefined ? null : 1,
      ],
    );
    await this.persist();
    const row = this.one('SELECT id FROM prs WHERE repo=? AND number=?', [
      repo,
      pr.number,
    ]);
    if (!row) throw new Error('Failed to store pull request');
    return Number(row.id);
  }

  async createReview(input: {
    prId: number;
    headSha: string;
    trigger: ReviewTrigger;
    rules: RulesFile;
  }): Promise<ReviewSummary> {
    const id = ulid();
    const now = new Date().toISOString();
    this.database.run(
      `INSERT INTO reviews
       (id, pr_id, head_sha, trigger, status, rules_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [
        id,
        input.prId,
        input.headSha,
        input.trigger,
        JSON.stringify(input.rules),
        now,
        now,
      ],
    );
    await this.persist();
    const summary = this.getSummary(id)!;
    this.eventSink?.({ type: 'review.updated', data: summary });
    return summary;
  }

  async updateReview(id: string, patch: ReviewPatch): Promise<ReviewDetail> {
    const columns: string[] = [];
    const values: SqlValue[] = [];
    const add = (column: string, value: SqlValue) => {
      columns.push(`${column}=?`);
      values.push(value);
    };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.summary !== undefined) add('summary', patch.summary);
    if (patch.verdict !== undefined) add('verdict', patch.verdict);
    if (patch.ruleResults !== undefined)
      add('rule_results', JSON.stringify(patch.ruleResults));
    if (patch.llmMeta !== undefined)
      add('llm_meta', JSON.stringify(patch.llmMeta));
    if (patch.diff !== undefined) add('diff_json', JSON.stringify(patch.diff));
    if (patch.error !== undefined) add('error', patch.error);
    if (patch.githubReviewId !== undefined)
      add('github_review_id', patch.githubReviewId);
    if (patch.githubReviewUrl !== undefined)
      add('github_review_url', patch.githubReviewUrl);
    if (patch.publishedAt !== undefined) add('published_at', patch.publishedAt);
    add('updated_at', new Date().toISOString());
    values.push(id);
    this.database.run(
      `UPDATE reviews SET ${columns.join(', ')} WHERE id=?`,
      values,
    );
    if (this.database.getRowsModified() === 0)
      throw new Error('Review not found');
    await this.persist();
    const review = this.getReview(id)!;
    if (patch.status !== undefined)
      this.eventSink?.({ type: 'review.updated', data: review });
    return review;
  }

  async replaceComments(reviewId: string, comments: NewComment[]) {
    this.database.run('BEGIN');
    try {
      this.database.run('DELETE FROM review_comments WHERE review_id=?', [
        reviewId,
      ]);
      for (const comment of comments) this.insertComment(reviewId, comment);
      this.database.run('COMMIT');
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
    await this.persist();
  }

  private insertComment(reviewId: string, comment: NewComment): ReviewComment {
    const parsed = ReviewCommentSchema.parse({ id: ulid(), ...comment });
    this.database.run(
      `INSERT INTO review_comments
       (id, review_id, path, line, side, severity, rule_id, body, suggestion,
        source, included, anchor_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parsed.id,
        reviewId,
        parsed.path,
        parsed.line,
        parsed.side,
        parsed.severity,
        parsed.ruleId ?? null,
        parsed.body,
        parsed.suggestion ?? null,
        parsed.source,
        parsed.included ? 1 : 0,
        parsed.anchorStatus,
      ],
    );
    return parsed;
  }

  async addComment(reviewId: string, comment: NewComment) {
    const created = this.insertComment(reviewId, comment);
    this.database.run('UPDATE reviews SET updated_at=? WHERE id=?', [
      new Date().toISOString(),
      reviewId,
    ]);
    await this.persist();
    return created;
  }

  async editComment(
    reviewId: string,
    commentId: string,
    patch: {
      body?: string;
      severity?: Severity;
      included?: boolean;
      suggestion?: string | null;
    },
  ): Promise<ReviewComment | undefined> {
    const columns: string[] = [];
    const values: SqlValue[] = [];
    if (patch.body !== undefined) {
      columns.push('body=?');
      values.push(patch.body);
    }
    if (patch.severity !== undefined) {
      columns.push('severity=?');
      values.push(patch.severity);
    }
    if (patch.included !== undefined) {
      columns.push('included=?');
      values.push(patch.included ? 1 : 0);
    }
    if (patch.suggestion !== undefined) {
      columns.push('suggestion=?');
      values.push(patch.suggestion);
    }
    if (columns.length === 0) return this.getComment(reviewId, commentId);
    values.push(reviewId, commentId);
    this.database.run(
      `UPDATE review_comments SET ${columns.join(', ')} WHERE review_id=? AND id=?`,
      values,
    );
    await this.persist();
    return this.getComment(reviewId, commentId);
  }

  async deleteComment(reviewId: string, commentId: string): Promise<boolean> {
    this.database.run(
      'DELETE FROM review_comments WHERE review_id=? AND id=?',
      [reviewId, commentId],
    );
    const deleted = this.database.getRowsModified() > 0;
    if (deleted) await this.persist();
    return deleted;
  }

  getDiff(id: string): DiffFile[] | undefined {
    const row = this.one('SELECT diff_json FROM reviews WHERE id=?', [id]);
    return row
      ? (JSON.parse(asString(row.diff_json)) as DiffFile[])
      : undefined;
  }

  getSummary(id: string): ReviewSummary | undefined {
    const row = this.reviewRows('WHERE r.id=?', [id])[0];
    return row ? this.toSummary(row) : undefined;
  }

  getReview(id: string): ReviewDetail | undefined {
    const row = this.reviewRows('WHERE r.id=?', [id])[0];
    if (!row) return undefined;
    const summary = this.toSummary(row);
    const comments = this.all(
      'SELECT * FROM review_comments WHERE review_id=? ORDER BY id',
      [id],
    ).map((comment) => this.toComment(comment));
    return ReviewDetailSchema.parse({
      ...summary,
      pr: {
        title: asString(row.title),
        body: asString(row.body),
        author: asString(row.author),
        url: asString(row.url),
        baseRef: asString(row.base_ref),
        headRef: asString(row.head_ref),
        additions: Number(row.additions),
        deletions: Number(row.deletions),
      },
      summary: asString(row.summary),
      verdict: asString(row.verdict),
      ruleResults: JSON.parse(asString(row.rule_results)),
      comments,
      ...(row.llm_meta ? { llmMeta: JSON.parse(asString(row.llm_meta)) } : {}),
      ...(row.github_review_id && row.github_review_url && row.published_at
        ? {
            github: {
              reviewId: asString(row.github_review_id),
              url: asString(row.github_review_url),
              publishedAt: asString(row.published_at),
            },
          }
        : {}),
    });
  }

  listReviews(
    options: {
      status?: ReviewStatus;
      repo?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): { items: ReviewSummary[]; nextCursor?: string } {
    const where: string[] = [];
    const parameters: SqlValue[] = [];
    if (options.status) {
      where.push('r.status=?');
      parameters.push(options.status);
    }
    if (options.repo) {
      where.push('p.repo=?');
      parameters.push(options.repo);
    }
    if (options.cursor) {
      where.push('r.id < ?');
      parameters.push(options.cursor);
    }
    const limit = options.limit ?? 30;
    parameters.push(limit + 1);
    const rows = this.reviewRows(
      `${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT ?`,
      parameters,
    );
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    return {
      items: selected.map((row) => this.toSummary(row)),
      ...(hasMore ? { nextCursor: asString(selected.at(-1)!.id) } : {}),
    };
  }

  listInboxPrs(): InboxPr[] {
    return this.all(
      `SELECT id, repo, number, title, author, url, head_sha, is_draft, last_seen_at
       FROM prs WHERE review_requested=1 ORDER BY last_seen_at DESC`,
    ).map((row) => ({
      id: Number(row.id),
      repo: asString(row.repo),
      number: Number(row.number),
      title: asString(row.title),
      author: asString(row.author),
      url: asString(row.url),
      headSha: asString(row.head_sha),
      isDraft: Boolean(row.is_draft),
      updatedAt: asString(row.last_seen_at),
    }));
  }

  async clearReviewRequests(): Promise<void> {
    this.database.run(
      'UPDATE prs SET review_requested=0 WHERE review_requested=1',
    );
    if (this.database.getRowsModified() > 0) await this.persist();
  }

  getLatestReviewForPr(
    repo: string,
    number: number,
  ): ReviewSummary | undefined {
    const row = this.reviewRows(
      'WHERE p.repo=? AND p.number=? ORDER BY r.created_at DESC LIMIT 1',
      [repo, number],
    )[0];
    return row ? this.toSummary(row) : undefined;
  }

  getReviewForHead(
    repo: string,
    number: number,
    headSha: string,
  ): ReviewSummary | undefined {
    const row = this.reviewRows(
      `WHERE p.repo=? AND p.number=? AND r.head_sha=?
       ORDER BY r.created_at DESC LIMIT 1`,
      [repo, number, headSha],
    )[0];
    return row ? this.toSummary(row) : undefined;
  }

  hasActiveJobForPr(repo: string, number: number): boolean {
    return Boolean(
      this.one(
        `SELECT j.id FROM jobs j JOIN prs p ON p.id=j.pr_id
         WHERE p.repo=? AND p.number=?
           AND j.status IN ('queued', 'running', 'retry_wait') LIMIT 1`,
        [repo, number],
      ),
    );
  }

  async enqueueJob(reviewId: string): Promise<ReviewJob> {
    const review = this.one('SELECT pr_id FROM reviews WHERE id=?', [reviewId]);
    if (!review) throw new Error('Review not found');
    const existing = this.one('SELECT * FROM jobs WHERE review_id=?', [
      reviewId,
    ]);
    if (existing) return this.toJob(existing);
    const id = ulid();
    const now = new Date().toISOString();
    try {
      this.database.run(
        `INSERT INTO jobs
         (id, review_id, pr_id, status, attempts, available_at, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`,
        [id, reviewId, review.pr_id!, now, now, now],
      );
    } catch (error) {
      if (/UNIQUE constraint failed: jobs\.pr_id/i.test(String(error)))
        throw new Error('A review job is already active for this pull request');
      throw error;
    }
    await this.persist();
    return this.toJob(this.one('SELECT * FROM jobs WHERE id=?', [id])!);
  }

  async recoverJobs(): Promise<number> {
    const now = new Date().toISOString();
    this.database.run(
      `UPDATE jobs SET status='queued', available_at=?, updated_at=?
       WHERE status='running'`,
      [now, now],
    );
    const recovered = this.database.getRowsModified();
    this.database.run(
      `UPDATE reviews SET status='queued', error=NULL, updated_at=?
       WHERE status IN ('gathering', 'reviewing')
         AND id IN (SELECT review_id FROM jobs WHERE status='queued')`,
      [now],
    );
    const recoveredReviews = this.database.getRowsModified();
    this.database.run(
      `INSERT OR IGNORE INTO jobs
       (id, review_id, pr_id, status, attempts, available_at, created_at, updated_at)
       SELECT lower(hex(randomblob(16))), r.id, r.pr_id, 'queued', 0, ?, ?, ?
       FROM reviews r LEFT JOIN jobs j ON j.review_id=r.id
       WHERE r.status='queued' AND j.id IS NULL`,
      [now, now, now],
    );
    const inserted = this.database.getRowsModified();
    if (recovered > 0 || recoveredReviews > 0 || inserted > 0)
      await this.persist();
    return recovered;
  }

  getJobForReview(reviewId: string): ReviewJob | undefined {
    const row = this.one('SELECT * FROM jobs WHERE review_id=?', [reviewId]);
    return row ? this.toJob(row) : undefined;
  }

  async claimNextJob(now = new Date()): Promise<ReviewJob | undefined> {
    const row = this.one(
      `SELECT * FROM jobs
       WHERE status IN ('queued', 'retry_wait') AND available_at<=?
       ORDER BY available_at, created_at LIMIT 1`,
      [now.toISOString()],
    );
    if (!row) return undefined;
    const id = asString(row.id);
    this.database.run(
      `UPDATE jobs SET status='running', attempts=attempts+1, updated_at=?
       WHERE id=? AND status IN ('queued', 'retry_wait')`,
      [now.toISOString(), id],
    );
    if (this.database.getRowsModified() === 0) return undefined;
    await this.persist();
    return this.toJob(this.one('SELECT * FROM jobs WHERE id=?', [id])!);
  }

  async completeJob(id: string): Promise<void> {
    await this.updateJob(id, 'done');
  }

  async failJob(id: string, error: string): Promise<void> {
    await this.updateJob(id, 'failed', { error });
  }

  async retryJob(id: string, error: string, availableAt: Date): Promise<void> {
    await this.updateJob(id, 'retry_wait', { error, availableAt });
  }

  nextJobAvailableAt(): string | undefined {
    const row = this.one(
      `SELECT MIN(available_at) available_at FROM jobs
       WHERE status IN ('queued', 'retry_wait')`,
    );
    return optionalString(row?.available_at);
  }

  listActivities(options: { limit?: number; cursor?: string } = {}): {
    items: ActivityEntry[];
    nextCursor?: string;
  } {
    const parameters: SqlValue[] = [];
    const where = options.cursor ? 'WHERE id < ?' : '';
    if (options.cursor) parameters.push(options.cursor);
    const limit = options.limit ?? 30;
    parameters.push(limit + 1);
    const rows = this.all(
      `SELECT * FROM activity ${where} ORDER BY id DESC LIMIT ?`,
      parameters,
    );
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    return {
      items: selected.map((row) =>
        ActivityEntrySchema.parse({
          id: asString(row.id),
          ts: asString(row.ts),
          level: asString(row.level),
          type: asString(row.type),
          message: asString(row.message),
          ...(optionalString(row.review_id)
            ? { reviewId: optionalString(row.review_id)! }
            : {}),
          ...(row.pr_id === null || row.pr_id === undefined
            ? {}
            : { prId: Number(row.pr_id) }),
        }),
      ),
      ...(hasMore ? { nextCursor: asString(selected.at(-1)!.id) } : {}),
    };
  }

  async addActivity(
    input: Omit<ActivityEntry, 'id' | 'ts'>,
  ): Promise<ActivityEntry> {
    const entry = ActivityEntrySchema.parse({
      id: ulid(),
      ts: new Date().toISOString(),
      ...input,
    });
    this.database.run(
      `INSERT INTO activity (id, ts, level, type, message, review_id, pr_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.ts,
        entry.level,
        entry.type,
        entry.message,
        entry.reviewId ?? null,
        entry.prId ?? null,
      ],
    );
    await this.persist();
    this.eventSink?.({ type: 'activity.created', data: entry });
    return entry;
  }

  private async updateJob(
    id: string,
    status: ReviewJob['status'],
    options: { error?: string; availableAt?: Date } = {},
  ) {
    const now = new Date().toISOString();
    this.database.run(
      `UPDATE jobs SET status=?, last_error=?, available_at=?, updated_at=? WHERE id=?`,
      [
        status,
        options.error ?? null,
        options.availableAt?.toISOString() ?? now,
        now,
        id,
      ],
    );
    if (this.database.getRowsModified() === 0) throw new Error('Job not found');
    await this.persist();
  }

  private toJob(row: Row): ReviewJob {
    return {
      id: asString(row.id),
      reviewId: asString(row.review_id),
      prId: Number(row.pr_id),
      status: asString(row.status) as ReviewJob['status'],
      attempts: Number(row.attempts),
      availableAt: asString(row.available_at),
      ...(optionalString(row.last_error)
        ? { lastError: optionalString(row.last_error)! }
        : {}),
    };
  }

  private reviewRows(suffix: string, parameters: SqlValue[]): Row[] {
    return this.all(
      `SELECT r.*, p.repo, p.number, p.title, p.body, p.author, p.url,
              p.base_ref, p.head_ref, p.additions, p.deletions,
              (SELECT COUNT(*) FROM review_comments c WHERE c.review_id=r.id) comment_count,
              (SELECT COUNT(*) FROM review_comments c WHERE c.review_id=r.id AND c.severity='blocker') blocker_count
       FROM reviews r JOIN prs p ON p.id=r.pr_id ${suffix}`,
      parameters,
    );
  }

  private toSummary(row: Row): ReviewSummary {
    return ReviewSummarySchema.parse({
      id: asString(row.id),
      repo: asString(row.repo),
      number: Number(row.number),
      prTitle: asString(row.title),
      headSha: asString(row.head_sha),
      trigger: asString(row.trigger),
      status: asString(row.status),
      commentCount: Number(row.comment_count),
      blockerCount: Number(row.blocker_count),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      ...(optionalString(row.error)
        ? { error: optionalString(row.error)! }
        : {}),
    });
  }

  private getComment(reviewId: string, commentId: string) {
    const row = this.one(
      'SELECT * FROM review_comments WHERE review_id=? AND id=?',
      [reviewId, commentId],
    );
    return row ? this.toComment(row) : undefined;
  }

  private toComment(row: Row): ReviewComment {
    return ReviewCommentSchema.parse({
      id: asString(row.id),
      path: asString(row.path),
      line: Number(row.line),
      side: asString(row.side),
      severity: asString(row.severity),
      ...(optionalString(row.rule_id)
        ? { ruleId: optionalString(row.rule_id)! }
        : {}),
      body: asString(row.body),
      ...(optionalString(row.suggestion)
        ? { suggestion: optionalString(row.suggestion)! }
        : {}),
      source: asString(row.source),
      included: Boolean(row.included),
      anchorStatus: asString(row.anchor_status),
    });
  }
}
