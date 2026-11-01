# PR Reviewer

A local, human-in-the-loop GitHub pull-request reviewer. It gathers a PR through the
`gh` CLI, checks repository-specific rules, drafts an editable AI review, and only
publishes when you explicitly choose pending or submit.

## Requirements

- Node.js 20 or newer
- pnpm 9
- [GitHub CLI](https://cli.github.com/) authenticated with an account that can read
  the repositories you want to review
- An OpenRouter API key, unless you select the built-in mock provider

## First-time setup

```bash
gh auth login
pnpm install
cp .env.example .env
```

Add your key to the repository-root `.env` file:

```dotenv
OPENROUTER_API_KEY=your_openrouter_key
```

The key stays in the environment. It is never returned by the API, stored in SQLite,
or written to logs.

## Run the application

For production-style local use:

```bash
pnpm start
```

This builds the shared package, backend, and frontend, then starts one server at
[http://127.0.0.1:4317](http://127.0.0.1:4317). Client-side routes are served by the
same local-only server.

For development with automatic reloads:

```bash
pnpm dev
```

The API runs on `127.0.0.1:4317`. Vite starts the web UI on its configured port and
automatically selects another free port if that port is occupied.

## Configure a repository

1. Open **Projects**.
2. Create a project using its `owner/repository` name.
3. Review the generated rules, enable the desired triggers, and save.
4. Paste a PR URL into the Inbox for a manual review, or enable automatic review
   requests in the rules and poller settings.

Only repositories with valid, enabled rules are sent to the model. AI output is
always an editable draft. Publishing defaults to a pending GitHub review, visible
only to you until you submit it.

## Local data

Runtime data is stored under `~/.pr-reviewer` by default:

```text
~/.pr-reviewer/
  config.yml
  data.db
  rules/
  logs/server.log
```

Server logs rotate at 5 MiB and retain five backups. Set `PR_REVIEWER_HOME` to use a
different data directory, which is useful for isolated testing.

## Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm review <github-pr-url> --dry-run
pnpm review <github-pr-url> --provider mock
```

The mock provider exercises the complete review flow without an API key.

## Troubleshooting

- **GitHub is not authenticated:** run `gh auth login`, then reload the app.
- **Settings or API requests fail:** confirm the backend is listening on port 4317
  and that the URL uses `localhost` or `127.0.0.1`.
- **No automatic review appears:** ensure polling is enabled and the repository rules
  set `triggers.on_review_request: auto`.
- **OpenRouter is not configured:** add `OPENROUTER_API_KEY` to `.env`, or select the
  mock provider in Settings.
- **A review is stale:** rerun it against the latest PR head before publishing.

The server intentionally binds only to `127.0.0.1` and rejects untrusted Host
headers. It is not intended to be exposed as a network service.
