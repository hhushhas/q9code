# Q9Code Desktop WebSocket Crash Session Log (2026-04-10)

- 2026-04-10T11:07:07Z Investigated desktop websocket error (`closeCode: 1006`) and traced it to a backend crash loop in the packaged app.
- 2026-04-10T11:07:07Z Confirmed root error from `~/.t3/userdata/logs/server-child.log`: `ERR_MODULE_NOT_FOUND` for `effect/dist/Context.js` imported via `@effect/platform-node-shared` in `app.asar`.
- 2026-04-10T11:07:07Z Reproduced staging dependency drift: temporary production install resolved `@effect/platform-node-shared@4.0.0-beta.46`, which imports `effect/Context`, while pinned `effect@4.0.0-beta.43` lacks `Context.js`.
- 2026-04-10T11:07:07Z Implemented packaging fix: stage build now pins `@effect/platform-node-shared` to the `@effect/platform-node` version via `ensureEffectRuntimeDependencyPins`, plus regression tests.
- 2026-04-10T11:13:50Z Verification passed: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
- 2026-04-10T11:13:50Z Additional sanity check passed: fresh production install with explicit `@effect/platform-node-shared` pin resolved `4.0.0-beta.43` and NodeStream no longer imports `effect/Context`.
