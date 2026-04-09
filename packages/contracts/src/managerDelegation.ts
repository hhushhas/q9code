import { Schema } from "effect";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { CodexModelOptions } from "./model";

const MANAGER_WORKER_ID_MAX_CHARS = 64;
const MANAGER_DELEGATION_MAX_WORKERS = 8;
export const MANAGER_WORKER_MODELS = ["gpt-5.4", "gpt-5.3-codex", "gpt-5.4-mini"] as const;
export type ManagerDelegationWorkerModel = (typeof MANAGER_WORKER_MODELS)[number];

export const ManagerDelegationWorkerId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MANAGER_WORKER_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/i),
);
export type ManagerDelegationWorkerId = typeof ManagerDelegationWorkerId.Type;

export const ManagerDelegationWorkerKind = Schema.Literals(["general", "review", "release"]);
export type ManagerDelegationWorkerKind = typeof ManagerDelegationWorkerKind.Type;

export const ManagerDelegationWorkerState = Schema.Literals([
  "planned",
  "waiting_on_dependencies",
  "ready",
  "running",
  "blocked",
  "completed",
  "failed",
]);
export type ManagerDelegationWorkerState = typeof ManagerDelegationWorkerState.Type;

export const ManagerDelegationWorkerModelSelection = Schema.Struct({
  provider: Schema.Literal("codex"),
  model: Schema.Literals(MANAGER_WORKER_MODELS),
  options: Schema.optionalKey(CodexModelOptions),
});
export type ManagerDelegationWorkerModelSelection =
  typeof ManagerDelegationWorkerModelSelection.Type;

export const ManagerDelegationWorker = Schema.Struct({
  id: ManagerDelegationWorkerId,
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  kind: ManagerDelegationWorkerKind.pipe(Schema.withDecodingDefault(() => "general")),
  dependsOn: Schema.Array(ManagerDelegationWorkerId).pipe(Schema.withDecodingDefault(() => [])),
  modelSelection: Schema.optionalKey(ManagerDelegationWorkerModelSelection),
  branch: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ManagerDelegationWorker = typeof ManagerDelegationWorker.Type;

export const ManagerDelegationManifest = Schema.Struct({
  summary: Schema.optionalKey(TrimmedNonEmptyString),
  workers: Schema.Array(ManagerDelegationWorker).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MANAGER_DELEGATION_MAX_WORKERS),
  ),
});
export type ManagerDelegationManifest = typeof ManagerDelegationManifest.Type;

export const ManagerDelegationWorkerSnapshot = Schema.Struct({
  workerId: ManagerDelegationWorkerId,
  threadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  state: ManagerDelegationWorkerState,
  blockingWorkerIds: Schema.Array(ManagerDelegationWorkerId).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});
export type ManagerDelegationWorkerSnapshot = typeof ManagerDelegationWorkerSnapshot.Type;
