# PR Reviewer v1 — Implementation Plan

As of Oct 25, 2026

## 1. Overview

v1 is a local web app that watches GitHub for PRs where you are requested as a reviewer, reviews each one against rules you wrote for that repo, and lets you edit the draft before it lands on GitHub as a pending review. It runs on your own machine and uses your `gh` CLI login for everything GitHub-related.

**Goals for v1**

- Detect open PRs that request your review, across every repo your `gh` login can see.
- Review only repos that have a rules file you wrote. No rules file means no review.
- Combine cheap deterministic checks (PR size, missing tests, forbidden files) with LLM judgment checks.
- Show the draft in a web UI with the diff, inline comments and a rule checklist, all editable.
- Publish to GitHub as a **pending** review by default, so nothing is public until you click submit.
- Let you trigger a review manually by pasting any PR URL, including PRs on your own repos.

**Non-goals for v1**

- No multi-user accounts, login, or hosting. It binds to `127.0.0.1` only.
- No GitLab or Bitbucket.
- No auto-submitting reviews. A human always presses the final button.
- No learning from your edits yet (planned for v2).

**Key decisions (change them here before kickoff if you disagree)**

| Decision      | Choice                                                       | Why                                                                                         |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Language      | TypeScript everywhere                                        | One language lets both agents share types for the API contract.                             |
| Repo shape    | pnpm monorepo: `apps/server`, `apps/web`, `packages/shared`  | Clear ownership lines between the two agents.                                               |
| GitHub access | `gh` CLI via child process                                   | Your existing login and permissions, no tokens to manage.                                   |
| Detection     | Polling `gh search prs` every 5 minutes                      | No public server or webhooks needed.                                                        |
| LLM           | OpenRouter behind a provider interface, plus a mock provider | `nvidia/nemotron-3.5-super-vl:free` provides zero-cost structured output; mock keeps tests deterministic and offline. |
| Storage       | SQLite for state, YAML files on disk for rules               | Rules stay human-editable and live inside the tool's data folder, never in a project repo.  |
| Ownership     | Codex: backend + shared contract. Claude Code: frontend.     | Requested split.                                                                            |

## 2. How it works end to end

Every review follows the same seven steps, whether it was triggered by the poller or by you pasting a URL. The backend does steps 1 to 5 and 7; the frontend owns step 6 and the buttons that start step 7.

```
┌───────────────────────┐        ┌──────────────────────────────────┐        ┌─────────────────────┐
│ Frontend · apps/web   │        │ Backend · apps/server            │        │ GitHub              │
│ (Claude Code)         │        │ (Codex)                          │◄──────►│ via your gh login   │
│                       │  /api  │                                  │        │ diffs and reviews   │
│  Inbox                │◄──────►│  API          REST + SSE, Zod    │        └─────────────────────┘
│  Review editor        │        │  Poller + job queue              │        ┌─────────────────────┐
│  Rules editor         │        │  Review engine  checks, prompt,  │◄──────►│ OpenRouter          │
│  History              │        │                 LLM, anchors     │        │ review model        │
│  Settings             │        │  Publisher    pending via gh api │        └─────────────────────┘
│                       │        │                                  │        ┌─────────────────────┐
│                       │        │                                  │◄──────►│ Your disk           │
│                       │        │                                  │        │ rules YAML, SQLite  │
└───────────┬───────────┘        └────────────────┬─────────────────┘        └─────────────────────┘
            └──────── packages/shared · the API contract both sides import ────────┘
```

The frontend only ever talks to the backend's `/api`; everything external goes through the backend.

1. **Detect.** The poller runs `gh search prs --review-requested=@me --state=open` and upserts each PR into SQLite.
2. **Match.** For each PR, the server looks for `~/.pr-reviewer/rules/<owner>__<repo>.yml`. No file means the PR shows in the inbox as "No rules" and nothing else happens.
3. **Decide.** If the rules say `on_review_request: auto` and this head SHA has not been reviewed, a review job is queued.
4. **Gather.** The job pulls PR metadata, the diff and any context files through `gh`.
5. **Review.** Deterministic checks run first. Then the LLM gets the rules, the deterministic results, the context files and a line-numbered diff, and returns structured comments.
6. **Edit.** The draft appears in the web UI. You edit, delete or add comments, change the summary and pick a verdict.
7. **Publish.** On your click, the server validates every comment anchor against the diff and creates a pending review on GitHub. You submit it there, or from the UI with an explicit confirmation.

**When the author pushes again.** The poller sees a new head SHA. A draft that was not yet published is marked `stale`. Depending on `on_new_commits`, the server re-reviews automatically, just flags it, or ignores it.

**Where things live on disk**

```
~/.pr-reviewer/            (override with PR_REVIEWER_HOME)
  config.yml               app settings
  rules/owner__repo.yml    one rules file per repo
  data.db                  SQLite: PRs, reviews, comments, activity
  logs/                    server logs
.env (in the repo root)    OPENROUTER_API_KEY, never sent to the browser
```

## 3. Roles: who owns what

The backend is the brain and the only thing that touches GitHub, the LLM or the disk; the frontend is the cockpit where you see and steer reviews. They meet at one place only: the API contract in `packages/shared`.

**Backend (Codex) owns `apps/server` and `packages/shared`**

- Talking to GitHub through `gh` (search, PR data, diffs, file contents, posting reviews).
- Polling, the job queue, and tracking which head SHA was reviewed.
- Loading and validating rules files, and the app config.
- The review engine: deterministic checks, prompt building, the LLM call, output validation.
- Diff parsing and comment-anchor validation.
- SQLite storage and the REST + server-sent events (SSE) API.
- A CLI (`pnpm review <pr-url>`) so the engine can be tested before any UI exists.
- The shared Zod schemas and TypeScript types that define every API request and response.

**Frontend (Claude Code) owns `apps/web`**

- Every screen: inbox, review editor, rules editor, history, settings.
- Rendering the diff the backend sends, with inline comments and the ability to add your own.
- The YAML rules editor with live validation feedback.
- Live updates from SSE, loading/empty/error states, toasts, confirm dialogs.
- A mock API layer (MSW) built from the shared types, so frontend work never waits on the backend.

**The frontend never** calls `gh`, the LLM, or the filesystem, and never sees the API key. **The backend never** renders HTML beyond serving the built frontend.

**Collaboration rules (put these in both `AGENTS.md` and `CLAUDE.md`)**

1. `packages/shared` is the contract. Codex writes it in Phase 0 and it is frozen after that.
2. If Claude Code needs a contract change, it adds an entry to `docs/CONTRACT_CHANGES.md` (what, why, proposed shape) and does not edit `packages/shared` itself. Codex applies it and bumps the change log.
3. Neither agent edits the other's app folder. Root config changes (`package.json`, `tsconfig.base.json`, lint) go through you.
4. Each agent works on its own branch prefix (`wiseman/…` for Codex, `claude/…` for Claude Code) and opens PRs into `main`. You merge. Bonus: once v1 works, the tool reviews these PRs.
5. Every PR states which phase task it completes and how it was tested.
6. When you hand an agent a phase, paste that phase's section from this doc plus the sections it references.

## 4. Tech stack and repo layout

One pnpm workspace, Node 20+, TypeScript strict mode in every package. `pnpm dev` runs server and web together; `pnpm start` serves the built web app from the server on one port.

| Area                  | Choice                                                                           | Owner            |
| --------------------- | -------------------------------------------------------------------------------- | ---------------- |
| Runtime               | Node 20+, pnpm 9 workspaces                                                      | Codex (scaffold) |
| Server framework      | Fastify                                                                          | Codex            |
| Validation / contract | Zod (schemas exported from `packages/shared`)                                    | Codex            |
| Database              | SQLite via portable `sql.js` with versioned SQL migrations                       | Codex            |
| YAML                  | `yaml` package (keeps comments when re-saving)                                   | Codex            |
| LLM                   | OpenRouter chat completions API, model set in config (default `nvidia/nemotron-3.5-super-vl:free`) | Codex            |
| Process exec          | `execa` wrapper around `gh`                                                      | Codex            |
| Frontend build        | Vite + React 18 + TypeScript                                                     | Claude Code      |
| Routing / data        | React Router, TanStack Query                                                     | Claude Code      |
| Styling               | Tailwind CSS (+ shadcn/ui primitives)                                            | Claude Code      |
| YAML editor           | CodeMirror 6 with YAML mode                                                      | Claude Code      |
| API mocking           | MSW (Mock Service Worker)                                                        | Claude Code      |
| Tests                 | Vitest everywhere; Testing Library on web                                        | Both             |
| Lint / format         | ESLint + Prettier, shared root config                                            | Codex (scaffold) |

**Repo layout**

```
pr-reviewer/
  package.json              workspace scripts: dev, build, start, test, lint, review
  pnpm-workspace.yaml
  tsconfig.base.json
  .env.example              OPENROUTER_API_KEY=
  AGENTS.md                 rules for Codex
  CLAUDE.md                 rules for Claude Code
  docs/
    PLAN.md                 this document
    CONTRACT_CHANGES.md     contract change requests + log
    rules-example.yml
  packages/shared/src/
    rules.ts                rules file schema (Zod)
    config.ts               app config schema
    api.ts                  every request/response schema
    events.ts               SSE event schemas
    enums.ts                ReviewStatus, Severity, Verdict, ...
    index.ts
  apps/server/src/
    index.ts                boot: config, db, gh check, poller, http
    cli.ts                  pnpm review <url> [--dry-run] [--provider mock]
    config/                 load + validate config.yml, paths
    gh/                     gh wrapper, typed commands, error mapping
    rules/                  load, validate, save, template
    diff/                   unified diff parser, anchor validation
    context/                gather PR data, diff, context files
    checks/                 deterministic check implementations
    llm/                    provider interface, openrouter, mock, prompt
    review/                 orchestrates gather -> checks -> llm -> save
    publish/                build + post GitHub review payload
    poller/                 search loop, SHA tracking, triggers
    jobs/                   persistent queue, concurrency, retries
    db/                     drizzle schema, migrations, repositories
    api/                    fastify routes, SSE hub
    test/fixtures/          real gh JSON + diff samples
  apps/web/src/
    main.tsx, App.tsx, routes.tsx
    api/                    typed client + query hooks + SSE hook
    mocks/                  MSW handlers + fixtures
    pages/                  Inbox, ReviewDetail, Projects, ProjectEditor, History, Settings
    components/             DiffView, CommentCard, RuleChecklist, StatusBadge, ...
    lib/                    formatting, helpers
```

In dev, Vite runs on port 5173 and proxies `/api` to the server on `127.0.0.1:4317`.

## 5. Rules file spec and app config

A rules file tells the tool when to review a repo, what to care about, and which specific checks to run; it is the single most important input. One file per repo at `~/.pr-reviewer/rules/<owner>__<repo>.yml` (inside the tool's data folder, never inside the project's codebase), validated by the Zod schema in `packages/shared/src/rules.ts`.

**Full example (also ships as `docs/rules-example.yml` and as the "new project" template)**

```yaml
version: 1
repo: acme/payments-api
enabled: true

triggers:
  on_review_request: auto # auto | manual  (manual = show in inbox, wait for a click)
  on_new_commits: notify # auto | notify | ignore
  skip_drafts: true

review:
  focus: # strict | normal | light | off
    security: strict
    correctness: strict
    performance: normal
    readability: light
    style: off
  tone: 'Concise. Suggest a fix, not just the problem.'
  max_comments: 10
  min_severity: minor # blocker | major | minor | nit  (drop anything below)
  ignore_paths: ['**/*.lock', 'docs/**', 'generated/**']
  context_files: ['CONTRIBUTING.md', 'src/middleware/auth.ts']
  instructions: |
    We use Result types, never throw in services.
    Money is always integer minor units.

rules:
  - id: auth-on-endpoints
    type: llm
    description: Every new HTTP endpoint uses the requireAuth middleware.
    severity: blocker
    paths: ['src/routes/**']

  - id: tests-for-logic
    type: require_tests
    when_paths: ['src/**/*.ts']
    test_paths: ['**/*.test.ts', 'tests/**']
    severity: major

  - id: pr-size
    type: max_changed_lines
    limit: 600
    severity: minor

  - id: no-env-files
    type: forbid_paths
    paths: ['.env*', '**/*.pem']
    severity: blocker

  - id: has-description
    type: require_description
    min_length: 30
    severity: minor

  - id: linked-issue
    type: require_linked_issue
    severity: nit
```

**Rule types in v1**

| type                   | Fields                          | Deterministic?  | Passes when                                                                     |
| ---------------------- | ------------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `llm`                  | `description`, optional `paths` | No (LLM judges) | The model reports it satisfied, or it does not apply to the changed files       |
| `require_tests`        | `when_paths`, `test_paths`      | Yes             | No file matches `when_paths`, or at least one changed file matches `test_paths` |
| `max_changed_lines`    | `limit`                         | Yes             | additions + deletions (excluding `ignore_paths`) ≤ `limit`                      |
| `forbid_paths`         | `paths`                         | Yes             | No changed file matches `paths`                                                 |
| `require_description`  | `min_length`                    | Yes             | PR body, trimmed, has at least `min_length` characters                          |
| `require_linked_issue` | none                            | Yes             | PR has a closing issue reference, or the body contains `#<number>`              |

Common to every rule: `id` (unique slug, required), `severity` (required), `enabled` (default true). Glob matching uses `picomatch`. Unknown rule types fail validation with a clear message naming the rule id.

**Validation behaviour**

- The server validates on load, on every save from the UI, and on a dedicated validate endpoint used for live editor feedback.
- Errors carry a YAML path and line number (e.g. `rules[2].limit: expected number`, line 41) so the editor can underline them.
- An invalid file is never used for a review; the inbox shows the repo as "Rules invalid".
- `repo` inside the file must match the file name.

**App config: `~/.pr-reviewer/config.yml`** (created with defaults on first run)

```yaml
server:
  port: 4317
poller:
  enabled: true
  interval_minutes: 5
  include_team_requests: false # false = direct requests only
llm:
  provider: openrouter # openrouter | mock
  model: nvidia/nemotron-3.5-super-vl:free
  max_input_tokens: 100000
  max_output_tokens: 8000
jobs:
  concurrency: 1
  max_retries: 2
```

The API key is read only from the environment (`OPENROUTER_API_KEY`, loaded from `.env`). The UI shows whether it is set, never the value.

## 6. Data model and review statuses

Four SQLite tables hold everything; a review is always tied to one PR at one head SHA, so a new push produces a new review row rather than mutating the old one.

**`prs`** — one row per PR the tool has seen

| Column                      | Type       | Notes                                       |
| --------------------------- | ---------- | ------------------------------------------- |
| id                          | integer pk |                                             |
| repo                        | text       | `owner/repo`                                |
| number                      | integer    | unique with `repo`                          |
| title, author, url          | text       |                                             |
| head_sha                    | text       | latest seen                                 |
| base_ref                    | text       |                                             |
| is_draft                    | boolean    |                                             |
| review_requested            | boolean    | true while it appears in the search results |
| first_seen_at, last_seen_at | text (ISO) |                                             |

**`reviews`** — one row per review attempt

| Column                               | Type       | Notes                                                                    |
| ------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| id                                   | text pk    | ULID, used in URLs                                                       |
| pr_id                                | integer fk |                                                                          |
| head_sha                             | text       | SHA this review covers                                                   |
| trigger                              | text       | `auto` \| `manual` \| `rerun`                                            |
| status                               | text       | see statuses below                                                       |
| summary                              | text       | editable                                                                 |
| verdict                              | text       | `COMMENT` \| `APPROVE` \| `REQUEST_CHANGES` (suggested by LLM, editable) |
| rule_results                         | json       | `[{ruleId, kind, status, note}]`                                         |
| rules_snapshot                       | json       | the parsed rules used, for reproducibility                               |
| llm_meta                             | json       | model, input/output tokens, duration, truncation notes                   |
| error                                | text       | set when `failed`                                                        |
| github_review_id, github_review_url  | text       | set after publish                                                        |
| created_at, updated_at, published_at | text (ISO) |                                                                          |

**`review_comments`**

| Column        | Type           | Notes                                                                    |
| ------------- | -------------- | ------------------------------------------------------------------------ |
| id            | text pk        | ULID                                                                     |
| review_id     | text fk        |                                                                          |
| path          | text           | file path                                                                |
| line          | integer        | line number in the file                                                  |
| side          | text           | `RIGHT` (new code) \| `LEFT` (deleted code)                              |
| severity      | text           | `blocker` \| `major` \| `minor` \| `nit`                                 |
| rule_id       | text, nullable | which rule produced it                                                   |
| body          | text           | markdown, editable                                                       |
| suggestion    | text, nullable | replacement code, rendered as a GitHub suggestion block                  |
| source        | text           | `ai` \| `user`                                                           |
| included      | boolean        | unticked comments are kept but not published                             |
| anchor_status | text           | `valid` \| `invalid` (not on a diff line; goes into the summary instead) |

**`activity`** — append-only log shown on the History page: id, ts, level (`info` | `warn` | `error`), type (e.g. `poll.completed`, `review.failed`, `review.published`), message, review_id?, pr_id?.

**Review statuses**

| Status              | Meaning                                            | Set by                                                                    |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `queued`            | Waiting for a job slot                             | poller, manual trigger, rerun                                             |
| `gathering`         | Fetching PR data and diff via `gh`                 | job                                                                       |
| `reviewing`         | Running checks and the LLM                         | job                                                                       |
| `draft_ready`       | Ready to edit in the UI                            | job                                                                       |
| `stale`             | New commits arrived before publishing              | poller                                                                    |
| `publishing`        | Posting to GitHub                                  | publish endpoint                                                          |
| `published_pending` | Pending review exists on GitHub, not yet submitted | publish endpoint                                                          |
| `submitted`         | Review is public on GitHub                         | publish endpoint (submit), or poller detecting you submitted it on GitHub |
| `dismissed`         | You chose not to publish                           | dismiss endpoint                                                          |
| `failed`            | Something broke; `error` says what                 | job / publish                                                             |

Allowed edits: comments, summary and verdict are editable only in `draft_ready` and `stale`. Rerun is allowed from `draft_ready`, `stale`, `failed` and `dismissed`, and creates a new review row. On server start, any review stuck in `gathering`, `reviewing` or `publishing` is reset to `queued` (or `failed` for publishing, after checking GitHub for an existing pending review).

## 7. Backend spec (Codex)

The backend is eleven small modules wired together by the review orchestrator; each one is unit-testable on its own because `gh` and the LLM are injected, never imported directly.

### 7.1 `gh/` — the GitHub wrapper

- `runGh(args: string[], opts?: {input?: string, timeoutMs?: number})` built on `execa('gh', args)`. Default timeout 30 s. Returns stdout; parses JSON when asked.
- Injected as an interface `GhClient` so tests use a fake that returns fixtures.
- Error mapping: "not logged in" → `GhAuthError`; HTTP 404 → `GhNotFoundError`; 403 with rate-limit text → `GhRateLimitError`; anything else → `GhError` with stderr attached.
- Typed commands it must expose:

| Function                                 | Command                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `authStatus()`                           | `gh auth status` + `gh api user --jq .login`                                                                                                                                         |
| `searchReviewRequests({teams})`          | `gh search prs --review-requested=@me --state=open --json number,title,repository,url,author,isDraft,updatedAt --limit 100` (direct-only: query `user-review-requested:@me` instead) |
| `getPr(repo, n)`                         | `gh pr view n -R repo --json number,title,body,author,url,baseRefName,headRefName,headRefOid,isDraft,additions,deletions,files,closingIssuesReferences,state`                        |
| `getDiff(repo, n)`                       | `gh pr diff n -R repo` (raw unified diff)                                                                                                                                            |
| `getFile(repo, path, ref)`               | `gh api repos/{repo}/contents/{path}?ref={ref} -H "Accept: application/vnd.github.raw"`                                                                                              |
| `listReviews(repo, n)`                   | `gh api repos/{repo}/pulls/{n}/reviews --paginate`                                                                                                                                   |
| `createReview(repo, n, payload)`         | `gh api repos/{repo}/pulls/{n}/reviews -X POST --input -` (JSON on stdin)                                                                                                            |
| `submitReview(repo, n, id, event, body)` | `gh api repos/{repo}/pulls/{n}/reviews/{id}/events -X POST --input -`                                                                                                                |
| `deletePendingReview(repo, n, id)`       | `gh api repos/{repo}/pulls/{n}/reviews/{id} -X DELETE`                                                                                                                               |

Never build shell strings; always pass an args array. Payloads go through stdin, never through command-line arguments.

### 7.2 `config/`

- Resolves `PR_REVIEWER_HOME` (default `~/.pr-reviewer`), creates the folder tree and a default `config.yml` on first run.
- Validates with the shared schema; invalid config stops the server with a readable message.
- Loads `.env` via `dotenv`. Exposes `isLlmConfigured()`.

### 7.3 `rules/`

- `listRules()`, `getRules(repo)`, `validateRulesYaml(text) → {valid, parsed?, errors[]}`, `saveRules(repo, text)`, `deleteRules(repo)`, `templateFor(repo)`.
- Errors include `path` (e.g. `rules.2.limit`), `message`, `line`, `column` (use the `yaml` package's node ranges to map paths to lines).
- Saves are atomic: write to a temp file, then rename. Keep the original text byte for byte when valid, so comments survive.

### 7.4 `diff/` — parser and anchors (heavily unit-tested)

- `parseDiff(raw) → DiffFile[]` where each file has `path`, `oldPath`, `status` (added/modified/deleted/renamed), `isBinary`, `additions`, `deletions`, and `hunks[]`. Each hunk has its header and `lines[]` of `{kind: 'add'|'del'|'context', oldLine?, newLine?, text}`.
- `commentableSet(files)`: for each path, the set of `RIGHT` lines (add + context) and `LEFT` lines (del). GitHub rejects comments outside hunks, which fails the whole review.
- `renderForPrompt(files)`: prints each line prefixed with its anchor, e.g. `R  42 + const x = 1`, `L  17 - oldCall()`, `R  43   unchanged`, so the model can cite exact anchors.
- `isValidAnchor(set, path, line, side)`.
- This same parsed structure is what the API sends to the frontend (`GET /api/reviews/:id/diff`), so the UI never parses diffs.

### 7.5 `context/`

- `gatherContext(repo, n)` returns `{pr, diffRaw, files: DiffFile[], contextFiles: [{path, content}], rulesForRepo}`.
- Applies `ignore_paths` (files still listed for deterministic checks, dropped from the prompt).
- Context files are fetched at the PR head SHA. A missing file adds a warning to `llm_meta`, not a failure. Each context file is capped at 20 000 characters.

### 7.6 `checks/` — deterministic rules

- One function per rule type: `(ctx, rule) → {ruleId, kind: 'deterministic', status: 'pass'|'fail'|'na', note}`.
- A failed check also produces a summary line (not an inline comment), e.g. "pr-size: 842 changed lines, limit 600".
- Runs before the LLM; results are passed into the prompt so the model does not repeat them.

### 7.7 `llm/` — provider and prompt

```ts
interface ReviewProvider {
  name: string;
  review(input: ReviewInput): Promise<{
    output: ReviewOutput;
    meta: {
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
    };
  }>;
}
```

- `OpenRouterProvider`: uses chat completions with strict JSON Schema output and `provider.require_parameters = true`. Parse the response and validate it with Zod; on schema failure retry once with validation feedback. Do not retry HTTP or quota errors. Record the actual model returned by OpenRouter in `llm_meta`.
- `MockProvider`: returns a deterministic `ReviewOutput` built from the diff (e.g. one comment on the first added line of each file). Used by tests, by `--provider mock`, and when no API key is set and the user opts in.
- `ReviewOutput` shape:

```ts
{
  summary: string,                 // markdown, 2-6 sentences
  verdict: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
  comments: Array<{
    path: string, line: number, side: 'RIGHT' | 'LEFT',
    severity: 'blocker' | 'major' | 'minor' | 'nit',
    ruleId?: string, body: string, suggestion?: string
  }>,
  ruleResults: Array<{ ruleId: string, status: 'pass' | 'fail' | 'na' | 'unsure', note: string }>
}
```

- **Prompt structure** (keep in `llm/prompt.ts`, snapshot-tested):
  1. System: role ("a senior reviewer applying this reviewer's rules, not generic advice"), output contract, hard rules: only comment on lines shown with an `R`/`L` anchor; one issue per comment; no praise-only comments; respect `max_comments` and `min_severity`; follow `tone`.
  2. User block A: PR title, author, description, base branch, size.
  3. User block B: the focus levels, `instructions`, and every enabled `llm` rule with its id, description, severity and paths.
  4. User block C: deterministic results ("already reported, don't repeat").
  5. User block D: context files, each fenced with its path.
  6. User block E: the anchored diff from `renderForPrompt`.
- **Token budget**: estimate tokens as characters / 4. If over `max_input_tokens`: drop ignored files, then lockfiles/generated/minified files, then truncate the largest files' hunks with a `[truncated N lines]` marker. Record what was cut in `llm_meta.truncation` and mention it in the summary. Chunked multi-call review is a v2 item.

### 7.8 `review/` — the orchestrator

`runReview(reviewId)`: set `gathering` → `gatherContext` → set `reviewing` → run checks → call provider → post-process → save → set `draft_ready`. Post-processing:

- Drop comments below `min_severity`; keep the highest-severity `max_comments`.
- Mark each comment's `anchor_status` with `isValidAnchor`. Invalid ones stay in the draft (shown in an "unanchored" section in the UI) but are folded into the summary on publish.
- Merge deterministic and LLM rule results into one `rule_results` list; any `llm` rule the model did not mention becomes `unsure`.
- Emit an SSE `review.updated` event at every status change. Any thrown error → `failed` with a human-readable `error`.

### 7.9 `publish/`

`publish(reviewId, {mode: 'pending' | 'submit', event?})`:

1. Reject unless status is `draft_ready` or `stale` (stale requires `force: true` from the UI after a warning).
2. Re-fetch the PR. If the head SHA changed since the review, return `409 HEAD_MOVED` unless forced.
3. Check `listReviews` for an existing `PENDING` review by you. GitHub allows only one per user per PR. If one exists, return `409 PENDING_EXISTS` with its id; the UI offers "replace it" which calls publish again with `replacePending: true` (delete, then create).
4. Build the payload: `commit_id` = review head SHA; `body` = summary + failed deterministic checks + any invalid-anchor comments as a list; `comments` = included, valid-anchor comments as `{path, line, side, body}` (append a GitHub `suggestion` code block when `suggestion` is set). Omit `event` for pending; set `event` for submit (`APPROVE` is rejected by GitHub on your own PRs; surface that error clearly).
5. Save `github_review_id`/url, set status, log activity.

### 7.10 `poller/` and `jobs/`

- Poller loop every `interval_minutes` (and on `POST /api/poll`). For each search result: upsert into `prs`; mark PRs no longer in the results as `review_requested = false`.
- Decision per PR with valid, enabled rules: if drafts are skipped and the PR is a draft, skip. If no review exists for the head SHA and `on_review_request = auto`, enqueue. If a review exists for an older SHA: `auto` → enqueue new review; `notify` → mark the old unpublished draft `stale`; `ignore` → nothing.
- For reviews in `published_pending`, the poller checks whether the pending review was submitted on GitHub and moves them to `submitted`.
- Jobs table-backed queue: concurrency from config (default 1), exponential backoff on `GhRateLimitError`, `max_retries` for transient errors. Never run two jobs for the same PR at once.
- A single poll must never crash the process; errors go to `activity` and the `poll.status` event.

### 7.11 `api/` and CLI

- Fastify on `127.0.0.1` only; reject requests whose `Host` header is not localhost (blocks DNS-rebinding). Every route validates input and output with the shared Zod schemas.
- SSE hub at `/api/events` with a 25 s heartbeat comment.
- Error responses always look like `{error: {code, message, details?}}`.
- In production mode, serve `apps/web/dist` and fall back to `index.html` for client routes.
- CLI `pnpm review <pr-url> [--dry-run] [--provider mock|openrouter] [--json]`: runs the same orchestrator; `--dry-run` prints the result and does not save or publish. This is the Phase 1–2 acceptance tool.

## 8. API contract

All endpoints live under `/api`, take and return JSON, and are defined as Zod schemas in `packages/shared/src/api.ts` before either agent writes a handler or a screen. Codex implements them; Claude Code mocks them with MSW until the real ones land.

**Endpoints**

| Method + path                       | Purpose                    | Request                                                          | Response                                                                                                                                    |
| ----------------------------------- | -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                       | Status banner              | —                                                                | `{gh: {authenticated, login?, error?}, llm: {configured, provider, model}, poller: {enabled, lastRunAt?, nextRunAt?, lastError?}, version}` |
| `GET /settings`                     | Read config                | —                                                                | `AppConfig`                                                                                                                                 |
| `PUT /settings`                     | Update config              | `Partial<AppConfig>`                                             | `AppConfig`                                                                                                                                 |
| `GET /inbox`                        | PRs requesting your review | —                                                                | `InboxItem[]`                                                                                                                               |
| `POST /poll`                        | Poll now                   | —                                                                | `{started: true}`                                                                                                                           |
| `GET /projects`                     | All rules files            | —                                                                | `ProjectSummary[]` = `{repo, enabled, valid, ruleCount, updatedAt, errorCount}`                                                             |
| `GET /projects/:owner/:repo`        | One rules file             | —                                                                | `{repo, yaml, valid, parsed?, errors[]}`                                                                                                    |
| `PUT /projects/:owner/:repo`        | Create or save             | `{yaml}`                                                         | same as above; `422` if invalid (not saved)                                                                                                 |
| `DELETE /projects/:owner/:repo`     | Delete rules               | —                                                                | `204`                                                                                                                                       |
| `POST /projects/validate`           | Live validation            | `{yaml}`                                                         | `{valid, errors[]}`                                                                                                                         |
| `GET /projects/template?repo=`      | Starter YAML               | —                                                                | `{yaml}`                                                                                                                                    |
| `GET /reviews`                      | List / history             | query `status?`, `repo?`, `limit?`, `cursor?`                    | `{items: ReviewSummary[], nextCursor?}`                                                                                                     |
| `POST /reviews`                     | Manual review              | `{prUrl}`                                                        | `ReviewSummary` (status `queued`)                                                                                                           |
| `GET /reviews/:id`                  | Full draft                 | —                                                                | `ReviewDetail`                                                                                                                              |
| `GET /reviews/:id/diff`             | Parsed diff                | —                                                                | `DiffFile[]` (section 7.4 shape)                                                                                                            |
| `PATCH /reviews/:id`                | Edit summary/verdict       | `{summary?, verdict?}`                                           | `ReviewDetail`                                                                                                                              |
| `POST /reviews/:id/comments`        | Add your comment           | `{path, line, side, body, severity}`                             | `ReviewComment`                                                                                                                             |
| `PATCH /reviews/:id/comments/:cid`  | Edit comment               | `{body?, severity?, included?, suggestion?}`                     | `ReviewComment`                                                                                                                             |
| `DELETE /reviews/:id/comments/:cid` | Remove                     | —                                                                | `204`                                                                                                                                       |
| `POST /reviews/:id/rerun`           | Re-review                  | —                                                                | new `ReviewSummary`                                                                                                                         |
| `POST /reviews/:id/dismiss`         | Don't publish              | —                                                                | `ReviewSummary`                                                                                                                             |
| `POST /reviews/:id/publish`         | Push to GitHub             | `{mode: 'pending' \| 'submit', event?, force?, replacePending?}` | `{status, githubReviewUrl, publishedComments, foldedIntoSummary}`; `409` with code `HEAD_MOVED` or `PENDING_EXISTS`                         |
| `GET /activity`                     | History log                | query `limit?`, `cursor?`                                        | `{items: ActivityEntry[], nextCursor?}`                                                                                                     |
| `GET /events`                       | Live updates (SSE)         | —                                                                | event stream                                                                                                                                |

**Key shapes**

```ts
InboxItem = {
  pr: { repo, number, title, author, url, headSha, isDraft, updatedAt },
  rulesState: 'none' | 'invalid' | 'disabled' | 'ok',
  latestReview?: ReviewSummary,      // for the current or an older SHA
  isStale: boolean                   // latestReview.headSha !== pr.headSha
}

ReviewSummary = {
  id, repo, number, prTitle, headSha, trigger, status,
  commentCount, blockerCount, createdAt, updatedAt, error?
}

ReviewDetail = ReviewSummary & {
  pr: { title, body, author, url, baseRef, headRef, additions, deletions },
  summary, verdict,
  ruleResults: Array<{ ruleId, kind: 'deterministic' | 'llm', status: 'pass'|'fail'|'na'|'unsure', note, severity }>,
  comments: ReviewComment[],
  llmMeta?: { provider, model, inputTokens, outputTokens, durationMs, truncation?: string[] },
  github?: { reviewId, url, publishedAt }
}

ReviewComment = {
  id, path, line, side: 'RIGHT'|'LEFT', severity: 'blocker'|'major'|'minor'|'nit',
  ruleId?, body, suggestion?, source: 'ai'|'user', included: boolean,
  anchorStatus: 'valid'|'invalid'
}

RulesError = { path: string, message: string, line?: number, column?: number }
```

**SSE events** (`packages/shared/src/events.ts`)

| Event              | Payload                                                                 | Frontend reaction                                       |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `review.updated`   | `ReviewSummary`                                                         | Update the inbox row and invalidate that review's query |
| `inbox.updated`    | `{count}`                                                               | Refetch `/inbox`                                        |
| `poll.status`      | `{state: 'running' \| 'idle' \| 'error', lastRunAt, nextRunAt, error?}` | Update the poll indicator                               |
| `activity.created` | `ActivityEntry`                                                         | Prepend to History if open                              |

**Error codes** the UI must handle by name: `GH_NOT_AUTHENTICATED`, `GH_NOT_FOUND`, `GH_RATE_LIMITED`, `LLM_NOT_CONFIGURED`, `RULES_INVALID`, `NO_RULES`, `INVALID_STATE`, `HEAD_MOVED`, `PENDING_EXISTS`, `VALIDATION_ERROR`, `INTERNAL`.

## 9. Frontend spec (Claude Code)

Six screens, one goal: get you from "a PR needs my review" to "a good review is pending on GitHub" in as few clicks as possible, with the AI draft always editable and never published without you.

### 9.1 App shell (every page)

- Left sidebar: Inbox (with a count badge), Projects, History, Settings.
- Top bar: poll indicator ("Last checked 2 min ago · Next in 3 min", spinner while running) and a "Check now" button (`POST /poll`).
- Health banner under the top bar when `/health` reports a problem, with the fix: "`gh` is not logged in — run `gh auth login`" or "No API key — add OPENROUTER_API_KEY to .env, or select the mock provider".
- One SSE connection for the app (`useEvents` hook) that updates TanStack Query caches; auto-reconnect with backoff.
- Toasts for async results; a confirm dialog component for anything that touches GitHub publicly.
- Light and dark theme following the system setting. Usable at 1280 px wide minimum; mobile is not a goal for v1.

### 9.2 Inbox (`/`)

- Table of `InboxItem`s, newest first: repo, PR title (links to GitHub), author, age, status badge, action button.
- Status badge logic: `rulesState` none → grey "No rules" + button "Add rules" (opens project editor with template for that repo); invalid → red "Rules invalid" + "Fix rules"; ok + no review → "Not reviewed" + "Review now"; otherwise the latest review's status, with "Stale" overlaid when `isStale`.
- Primary action per status: `draft_ready` → "Open draft"; `queued/gathering/reviewing` → progress text, disabled; `failed` → "Retry" + error tooltip; `published_pending` → "Open on GitHub".
- "Review a PR by URL" input at the top (`POST /reviews`), for manual reviews of any PR.
- Empty state: "Nothing is waiting on you" with the last poll time.

### 9.3 Review detail (`/reviews/:id`) — the main screen

Layout: header, then a two-column body (left rail 320 px, diff on the right), then a sticky action bar.

- **Header**: PR title, `repo#number`, author, branch names, short head SHA, GitHub link, status badge, model + token count in small text. Yellow banner when stale: "New commits since this draft · Re-run review".
- **Left rail**: verdict select (Comment / Approve / Request changes); summary textarea (markdown, autosave on blur via `PATCH`); rule checklist grouped by status (fail first) showing rule id, severity, pass/fail/unsure icon and note; truncation notice if `llmMeta.truncation` is set; "Unanchored comments" list with an explanation that these go into the summary.
- **Diff view** (renders `GET /reviews/:id/diff`, no parsing on the client): file list with collapse toggles and per-file comment counts; unified view with old/new line numbers; AI and user comments rendered inline under their line; ignored files collapsed by default with an "ignored by rules" tag; binary files show a placeholder.
- **Comment card**: severity chip (editable dropdown), rule id tag, markdown body (click to edit, save via `PATCH`), suggestion shown as a code block, "include" checkbox (unticked = dimmed), delete button. `source: user` comments get a different accent.
- **Add a comment**: hover a line number on a commentable line → "+" button → inline editor → `POST /comments`. Non-commentable lines show no "+".
- **Action bar**: counts ("7 comments · 2 blockers · 1 excluded"), Rerun, Dismiss, **Publish as pending review** (primary), and "Submit now…" which opens a confirm dialog that repeats the verdict and comment count.
- **Publish errors**: `HEAD_MOVED` → dialog "The author pushed new commits. Publish anyway (comments may be outdated) or re-run?"; `PENDING_EXISTS` → dialog "You already have a pending review on this PR. Replace it?"; success → toast with "Open on GitHub" link and the count of comments folded into the summary.
- Editing is disabled (read-only view) unless status is `draft_ready` or `stale`. While `queued/gathering/reviewing`, show a progress state that updates via SSE.

### 9.4 Projects (`/projects`) and Project editor (`/projects/:owner/:repo`)

- List: repo, enabled, valid/invalid with error count, rule count, last updated; "New project" button asking for `owner/repo` and loading the template.
- Editor: CodeMirror YAML on the left; on the right a live panel showing validation errors (debounced 400 ms `POST /projects/validate`) with click-to-jump to line, plus a parsed summary (triggers, focus levels, list of rules with type and severity) so you can confirm the file means what you think.
- Error underlines in the editor at the reported line/column. Save button disabled while invalid; `Ctrl/Cmd+S` saves. Unsaved-changes guard on navigation. Delete with confirm.
- A collapsible "Reference" drawer documenting every field and rule type (copy the tables from section 5).

### 9.5 History (`/history`)

- Two tabs: Reviews (all reviews with filters for status and repo, paginated) and Activity (log entries, live-prepended via SSE, level filter).

### 9.6 Settings (`/settings`)

- Form for `AppConfig`: poll enabled/interval, include team requests, provider and model, token limits, job concurrency. Read-only status rows for `gh` login and API key presence. Save via `PUT /settings`.

### 9.7 Frontend engineering rules

- Types come only from `@pr-reviewer/shared`; no hand-written duplicates of API shapes.
- All server calls go through `src/api/client.ts` (fetch wrapper that parses the error shape) and query hooks in `src/api/hooks.ts`.
- MSW is on when `VITE_USE_MOCKS=true`; fixtures cover every status, a stale review, unanchored comments, a truncated review, invalid rules, and every error code.
- Component tests for DiffView, CommentCard, RuleChecklist, publish dialogs and the inbox status logic.

## 10. Phased build plan

Six phases; only Phase 0 is sequential (Codex first, because the contract must exist), after which both agents work in parallel against the contract, and you merge at the end of each phase. Do not start a phase until the previous phase's "done when" checks pass.

### Phase 0 — Foundation and contract

**Codex**

- [ ] Scaffold the pnpm workspace, `tsconfig.base.json`, ESLint, Prettier, Vitest, root scripts (`dev`, `build`, `start`, `test`, `lint`, `review`).
- [ ] Create `packages/shared` with every schema from sections 5, 6 and 8: rules, config, enums, API requests/responses, SSE events. Export inferred types.
- [ ] Generate JSON Schema for `ReviewOutput` from Zod (for the LLM tool) and add a test that it stays in sync.
- [ ] Write `AGENTS.md`, `CLAUDE.md` (the collaboration rules from section 3), `docs/CONTRACT_CHANGES.md`, `docs/rules-example.yml`, `.env.example`.
- [ ] Minimal Fastify server with `GET /api/health` returning a hard-coded healthy response.

**Claude Code** (starts once Codex's Phase 0 PR is merged)

- [ ] Scaffold `apps/web`: Vite, React, Tailwind, shadcn/ui, React Router, TanStack Query, MSW, Vitest.
- [ ] Typed API client and error handling; MSW handlers for every endpoint with fixtures typed from `@pr-reviewer/shared`.
- [ ] App shell with sidebar routes (placeholder pages), health banner, poll indicator.

**Done when:** `pnpm dev` starts both apps; the web app shows the shell and the health banner reading from the real `/api/health`; `pnpm test` and `pnpm lint` pass; `packages/shared` builds.

### Phase 1 — GitHub access, rules, diff (backend) · Projects screens (frontend)

**Codex**

- [ ] `gh/` wrapper with every typed command and error mapping; fake client + fixtures captured from real `gh` output.
- [ ] `config/` with first-run setup.
- [ ] `rules/` load/validate/save/template with line-numbered errors; `/projects*` endpoints.
- [ ] `diff/` parser, commentable sets, prompt rendering; tests with at least: multi-hunk file, added file, deleted file, renamed file, binary file, "no newline at end of file".
- [ ] Real `/api/health` (gh auth + LLM configured).
- [ ] CLI `pnpm review <url> --dry-run` that prints PR metadata, parsed file stats and which rules apply.

**Claude Code**

- [ ] Projects list and Project editor (section 9.4) with live validation, error underlines, parsed summary, reference drawer.
- [ ] Settings page against mocks.

**Done when:** against a real PR you can access, `pnpm review <url> --dry-run` prints correct metadata and file stats; you can create, edit and save a rules file from the UI against the real backend, and an invalid edit shows the right line.

### Phase 2 — Review engine (backend) · Review detail screen (frontend)

**Codex**

- [ ] `context/` gathering with ignore paths and context files.
- [ ] `checks/` for all five deterministic rule types, with tests.
- [ ] `llm/`: provider interface, `MockProvider`, `OpenRouterProvider` with strict JSON Schema output, validation + one retry, token budgeting.
- [ ] `prompt.ts` with snapshot tests.
- [ ] `review/` orchestrator with post-processing; `db/` schema and migrations.
- [ ] Endpoints: `POST /reviews` (runs inline for now), `GET /reviews`, `GET /reviews/:id`, `GET /reviews/:id/diff`, `PATCH`, comment CRUD, `rerun`, `dismiss`.
- [ ] CLI without `--dry-run` saves the review; `--provider mock` works with no API key.

**Claude Code**

- [ ] Review detail page (section 9.3) except publish: header, left rail, rule checklist, DiffView, CommentCard, add-comment flow, unanchored list, read-only mode.
- [ ] "Review a PR by URL" input wired to `POST /reviews`.

**Done when:** you paste a real PR URL in the UI, a real OpenRouter-backed review appears with comments on the right lines, and edits to comments and summary survive a page reload. Mock-provider review works with the API key removed.

### Phase 3 — Publishing (backend) · Publish flow + Inbox (frontend)

**Codex**

- [ ] `publish/` with anchor validation, summary folding, suggestion blocks, `HEAD_MOVED` and `PENDING_EXISTS` handling, replace-pending, submit with event.
- [ ] `POST /reviews/:id/publish`; `GET /inbox` (from the DB plus a live search if the DB is empty).

**Claude Code**

- [ ] Action bar, publish and submit confirm dialogs, both 409 dialogs, success toast.
- [ ] Inbox page (section 9.2) with status badge logic and actions.

**Done when:** publishing creates a pending review on GitHub with comments on the correct lines that only you can see; submitting from GitHub works; a second publish shows the "replace pending" dialog and replacing works; an invalid anchor ends up in the summary instead of breaking the publish.

### Phase 4 — Automation (backend) · Live updates, History (frontend)

**Codex**

- [ ] Persistent job queue with concurrency, retries, backoff, one-job-per-PR lock, restart recovery. `POST /reviews` now enqueues instead of running inline.
- [ ] Poller with trigger decisions, stale marking, submitted detection; `POST /poll`.
- [ ] SSE hub and all four events; `GET /activity`.

**Claude Code**

- [ ] `useEvents` hook updating query caches; live progress on review detail and inbox.
- [ ] History page (both tabs); poll indicator wired to `poll.status`.

**Done when:** a teammate requests your review and, without touching anything, a draft shows up in the inbox within one poll interval; a new push marks it stale; the UI updates without reloads.

### Phase 5 — Integration and hardening (both)

- [ ] **Claude Code:** run the full app with `VITE_USE_MOCKS=false`; fix every mismatch through `CONTRACT_CHANGES.md`; polish loading, empty and error states for every error code; keyboard shortcuts (`j/k` next/previous comment, `Cmd+Enter` save).
- [ ] **Codex:** production mode serving `apps/web/dist`; Host-header check; log rotation; README with setup steps (`gh auth login`, `.env`, `pnpm install`, `pnpm start`).
- [ ] **You:** run the end-to-end checklist in section 11 on a sandbox repo.

**Done when:** every item in the end-to-end checklist passes from a fresh clone.

## 11. Testing, safety rules and end-to-end checklist

Tests run without network access by default; the only real-GitHub and real-LLM runs are the manual end-to-end checklist below, on a sandbox repo you own.

**Testing strategy**

| Layer          | What                                                                        | Tool                           |
| -------------- | --------------------------------------------------------------------------- | ------------------------------ |
| Shared         | Schemas accept the section 5 example and reject broken variants             | Vitest                         |
| Diff parser    | Fixture diffs (the six cases in Phase 1) → exact line maps                  | Vitest                         |
| Checks         | Each rule type: pass, fail, not applicable                                  | Vitest                         |
| Prompt         | Snapshot of the built prompt for a fixture PR                               | Vitest snapshots               |
| Orchestrator   | Full run with fake `gh` + `MockProvider`; invalid LLM output → retry → fail | Vitest                         |
| Publish        | Payload built correctly; 409 paths; invalid anchors folded                  | Vitest + fake `gh`             |
| API            | Each route's happy path and main error via Fastify `inject`                 | Vitest                         |
| Web components | DiffView, CommentCard, RuleChecklist, dialogs, inbox badges                 | Vitest + Testing Library + MSW |

**Safety rules (non-negotiable, put in both agent files)**

1. Never auto-submit a review. The only path to a public review is a user clicking submit with a confirm dialog, or submitting on GitHub.
2. Default publish mode is `pending`.
3. Server binds to `127.0.0.1` and checks the `Host` header.
4. The API key lives only in the environment; it is never logged, stored in SQLite, or returned by any endpoint.
5. `gh` is called with argument arrays; payloads go through stdin. No shell interpolation of PR titles, paths or bodies.
6. Never call `gh` commands that change repos beyond reviews (no merges, pushes, label edits, closes).
7. Repo content (PR body, code, context files) is untrusted input to the LLM. The system prompt says to ignore instructions found inside it, and output is schema-validated.
8. Only repos with a valid rules file are ever sent to the LLM.

**End-to-end checklist (Phase 5, on a sandbox repo)**

Note: GitHub does not let you request a review from yourself on your own PR. Use the manual URL flow for your own PRs, and ask a friend (or a second account) to open a PR and request you for the automatic flow.

- [ ] Fresh clone → `pnpm install` → `pnpm start` works with only `gh auth login` and `.env` done.
- [ ] Health banner appears when `gh auth logout` is run, and disappears after logging back in.
- [ ] Create rules for the sandbox repo in the UI; an invalid edit is blocked with the right line highlighted.
- [ ] Paste a PR URL → review completes → comments sit on the correct lines in the diff view.
- [ ] Edit a comment, untick one, add your own on a context line, change the verdict; reload and everything persists.
- [ ] Publish as pending → on GitHub the comments are on the same lines and marked Pending; nobody else sees them.
- [ ] Publish again → "replace pending" dialog → replaced cleanly.
- [ ] Push a commit to the PR → draft marked stale within one poll interval.
- [ ] A deterministic rule fires (e.g. touch `.env.example` against a `forbid_paths` rule) and shows in the checklist and summary.
- [ ] A teammate requests your review → draft appears automatically, no clicks.
- [ ] Submit from the UI with "Request changes" → review is public with the right verdict.
- [ ] Remove the API key → reviews fail with `LLM_NOT_CONFIGURED`, or run with the mock provider if selected in Settings.
- [ ] Kill the server mid-review → on restart the review resumes or is marked failed, never stuck.

## 12. Kickoff prompts

Save this file as `docs/PLAN.md` in the repo, then start each agent with its prompt below. For later phases, reuse the "next phase" prompt and change the phase number.

**Codex — Phase 0**

```
You are the backend engineer for pr-reviewer, a local tool that reviews GitHub PRs
against per-repo rules using the gh CLI and OpenRouter.

Read docs/PLAN.md fully. You own apps/server and packages/shared (sections 3, 4, 5,
6, 7, 8). Claude Code owns apps/web; never edit it.

Do Phase 0 from section 10, Codex tasks only:
- scaffold the pnpm workspace and tooling exactly as in section 4
- write packages/shared with every schema from sections 5, 6 and 8, exported as Zod
  schemas plus inferred types; this is the frozen contract, so be complete and precise
- write AGENTS.md and CLAUDE.md using the collaboration rules (section 3) and safety
  rules (section 11)
- add docs/CONTRACT_CHANGES.md, docs/rules-example.yml, .env.example
- minimal Fastify server on 127.0.0.1:4317 with GET /api/health

Work on branch wiseman/phase-0. Stop when the Phase 0 "done when" checks pass, then
open a PR listing each task and how you verified it. Do not start Phase 1.
```

**Claude Code — Phase 0 (after Codex's Phase 0 PR is merged)**

```
You are the frontend engineer for pr-reviewer, a local tool that reviews GitHub PRs
against per-repo rules.

Read docs/PLAN.md fully, then CLAUDE.md. You own apps/web only (sections 3, 4, 8, 9).
The API contract is packages/shared; import types from @pr-reviewer/shared and never
edit that package. If you need a contract change, add an entry to
docs/CONTRACT_CHANGES.md and tell me.

Do Phase 0 from section 10, Claude Code tasks only:
- scaffold apps/web with the stack in section 4
- typed API client + error handling, and MSW handlers with fixtures for every
  endpoint in section 8 (cover every status and error code)
- app shell from section 9.1 with placeholder pages

Work on branch claude/phase-0. Stop when the Phase 0 "done when" checks pass, then
open a PR listing each task and how you verified it. Do not start Phase 1.
```

**Next phase prompt (either agent)**

```
Re-read docs/PLAN.md sections <list> and docs/CONTRACT_CHANGES.md.
Do Phase <N> from section 10, <Codex | Claude Code> tasks only, on branch
<wiseman|claude>/phase-<N>. Write tests as described in section 11.
Stop when that phase's "done when" checks pass and open a PR. Do not start the next
phase.
```

**Your job between phases**

1. Review and merge both PRs (Codex first if both touch the build).
2. Apply any `CONTRACT_CHANGES.md` requests by asking Codex to implement them before the next phase.
3. Run the phase's "done when" checks yourself.
4. From Phase 3 on, point the tool at its own PRs.
