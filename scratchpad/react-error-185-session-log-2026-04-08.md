# React error 185 session log

## 2026-04-08 17:52:02 PKT

- Investigated the regression reported after commit `5eed840b`.
- Confirmed React error `#185` expands to "Maximum update depth exceeded."
- Traced the likely frontend cause to the new manager-thread work in `apps/web/src/components/ChatView.tsx`.

## 2026-04-08 17:52:02 PKT

- Found a new Zustand selector returning `store.threads.filter(...)` directly from `useStore`.
- In React 19 this can loop because the selector creates a fresh array snapshot every render.
- Patched the selector to use `useShallow` and added a browser regression test that mounts a manager thread.

## 2026-04-08 17:58:38 PKT

- Verified the fix with `bun run fmt`, `bun run lint`, `bun run typecheck`, and `bun run test`.
- Added targeted browser coverage with `bun run --filter @t3tools/web test:browser -- -t 'renders manager threads without entering a React update loop'`.
- Need to stage only the scoped frontend fix because the repo has unrelated local modifications in other files.
