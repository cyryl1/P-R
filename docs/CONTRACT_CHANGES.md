# Contract changes

The shared API contract was established for Phase 0. Claude Code should add proposed changes below; Codex records the applied shape and date when updating `packages/shared`.

## Requests

### Mark ignored files in `GET /reviews/:id/diff` (requested by web, Phase 2)

Add `ignored: z.boolean().optional()` to `DiffFileSchema`, true when the path matches the repo's `ignore_paths`. The web UI must collapse such files and tag them "ignored by rules" (PLAN 9.3), but the contract carries no such flag. Until it exists, the UI treats any non-binary file with no hunks as ignored.

## Applied changes

### Phase 1 — 2026-10-25

1. `POST /api/projects/validate` returns `{valid, errors, parsed?}`. The `parsed` rules file is present when validation succeeds. Added `ApiSchemas.projects.validateResponse`.
2. `GET /api/projects/:owner/:repo` returns `404` with `NO_RULES` when no file exists. The backend route implements this behavior; the shared API error code already includes `NO_RULES`.
3. Added the declared `GET /api/projects/template` response shape `{yaml}` to the shared contract so the backend can validate its output.

### OpenRouter provider — 2026-10-26

1. Replaced the `anthropic` provider enum value with `openrouter` in `AppConfig` and the health response. The default is now `{provider: openrouter, model: openrouter/free}`.
2. Changed the LLM wire schema so optional comment fields are required nullable values. This makes `ReviewOutput` compatible with strict JSON Schema providers; Zod normalizes `null` back to omitted application fields.

### Explicit OpenRouter free model — 2026-10-31

1. Changed the default OpenRouter model from the dynamic `openrouter/free` router to `nvidia/nemotron-3.5-super-vl:free`, which advertises strict structured-output support. Existing configs using the former default are migrated on startup; explicitly configured models remain unchanged.
