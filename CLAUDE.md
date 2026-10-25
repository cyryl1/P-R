# Claude Code guidance

Read `docs/PLAN.md` and implement only the frontend tasks assigned for the active phase. Claude Code owns `apps/web`; Codex owns `apps/server` and `packages/shared`. Do not edit the other agent's app folder.

## Collaboration

1. `packages/shared` is the API contract and is frozen after Phase 0.
2. If a contract change is needed, add the request and proposed shape to `docs/CONTRACT_CHANGES.md`; do not edit `packages/shared`.
3. Work on `claude/*` branches and open PRs into `main`. The user merges.
4. Every PR states which phase it completes and how it was checked.

## Safety

- Never auto-submit a review. A user must explicitly submit with confirmation.
- Publish as a pending review by default.
- The frontend only talks to the backend API. Never call `gh`, an LLM, or access the filesystem from browser code.
- Never expose the API key to the browser.
