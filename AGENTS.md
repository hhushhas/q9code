# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Local Skills

- Use the repo-local release skill at `.agents/skills/q9-release/SKILL.md` when Hasan asks to ship, release a version, build a new DMG, or package the latest Q9 desktop build.

## Temporary Manager/Worker Runtime Prompt Contract (2026-04-10)

Use this as the temporary stable prompt-content source until session-level instruction injection is fully implemented.

Manager runtime rules:

- The manager is coordinator-only by default: clarify, plan, delegate, reconcile, and escalate only for real blockers, risk, or product decisions.
- Prefer reusing an existing worker when continuity matters and that worker already owns the task.
- Launch a new worker only when the work is genuinely separate, parallelizable, or needs a fresh bounded assignment.
- If sending follow-up input to an existing worker, choose mode intentionally: `queue` lets current work continue; `interrupt` stops current work and delivers immediately.
- If the task is new/separate, launch a new worker instead of forcing it through an unrelated existing worker.
- Keep stable worker ids for follow-up coordination, and declare `dependsOn` whenever downstream workers must wait on upstream workers.
- Treat dependency sequencing as first-class: do not launch release/review/follow-up workers before required dependencies are completed.
- Keep manager-facing outcomes separate from raw runtime state; worker outcome tags are explicit manager coordination signals.

Checklist fenced syntax (manager session log):

```manager-checklist
1. [ ] Pending task
2. [x] Completed task
```

The latest dedicated `manager-checklist` fence is the parse target for manager checklist UX.

Sacred memory and logs:

- Sacred memory lives under `scratchpad/<manager-name>/`.
- Manager may read/write across the manager folder.
- Workers may read the manager folder when needed, but `manager-session-log.md` is read-only to workers.
- Worker logs are stable per worker under `scratchpad/<manager-name>/workers/<worker-thread-id>.md`.
- Workers write durable worker-local notes only to their assigned worker log.

Worker outcome tag contract:

- Final manager-facing worker outcomes must be wrapped in exactly one explicit block:

```xml
<worker_complete>
Final outcome, verification, blockers resolved, and any concrete next step.
</worker_complete>
```

```xml
<worker_blocked>
What is blocked, what you already tried, and the exact help or decision needed.
</worker_blocked>
```

- Use `<worker_complete>` only when the assigned task is done.
- Use `<worker_blocked>` only when blocked and manager intervention is required.
- Do not use worker outcome tags in intermediary progress updates.

## Project Snapshot

Q9 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@q9tools/shared/git`) — no barrel index.

## Codex App Server (Important)

Q9 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
