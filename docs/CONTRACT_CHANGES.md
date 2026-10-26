# Contract changes

The shared API contract was established for Phase 0. Claude Code should add proposed changes below; Codex records the applied shape and date when updating `packages/shared`.

## Requests

_None pending._

## Applied changes

### Phase 1 — 2026-10-25

1. `POST /api/projects/validate` returns `{valid, errors, parsed?}`. The `parsed` rules file is present when validation succeeds. Added `ApiSchemas.projects.validateResponse`.
2. `GET /api/projects/:owner/:repo` returns `404` with `NO_RULES` when no file exists. The backend route implements this behavior; the shared API error code already includes `NO_RULES`.
3. Added the declared `GET /api/projects/template` response shape `{yaml}` to the shared contract so the backend can validate its output.
