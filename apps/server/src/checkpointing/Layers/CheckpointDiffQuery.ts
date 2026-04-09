import {
  OrchestrationGetTurnDiffResult,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { filterUnifiedDiffByPaths } from "../Diffs.ts";
import { CheckpointInvariantError, CheckpointUnavailableError } from "../Errors.ts";
import { checkpointRefForThreadTurn } from "../Utils.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../Services/CheckpointDiffQuery.ts";

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);

function isWorkerScopedThread(input: {
  readonly role: "default" | "manager" | "worker";
  readonly managerThreadId: string | null;
}) {
  return input.role === "manager" || input.managerThreadId !== null;
}

const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore;

  const getTurnDiff: CheckpointDiffQueryShape["getTurnDiff"] = Effect.fn("getTurnDiff")(
    function* (input) {
      const operation = "CheckpointDiffQuery.getTurnDiff";

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff;
      }

      const threadContext = yield* projectionSnapshotQuery.getThreadCheckpointContext(
        input.threadId,
      );
      if (Option.isNone(threadContext)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Thread '${input.threadId}' not found.`,
        });
      }

      const maxTurnCount = threadContext.value.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`,
        });
      }

      const workspaceCwd = threadContext.value.worktreePath ?? threadContext.value.workspaceRoot;
      if (!workspaceCwd) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Workspace path missing for thread '${input.threadId}' when computing turn diff.`,
        });
      }

      const fromCheckpointRef =
        input.fromTurnCount === 0
          ? checkpointRefForThreadTurn(input.threadId, 0)
          : threadContext.value.checkpoints.find(
              (checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount,
            )?.checkpointRef;
      if (!fromCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      const toCheckpointRef = threadContext.value.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
      )?.checkpointRef;
      if (!toCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      const [fromExists, toExists] = yield* Effect.all(
        [
          checkpointStore.hasCheckpointRef({
            cwd: workspaceCwd,
            checkpointRef: fromCheckpointRef,
          }),
          checkpointStore.hasCheckpointRef({
            cwd: workspaceCwd,
            checkpointRef: toCheckpointRef,
          }),
        ],
        { concurrency: "unbounded" },
      );

      if (!fromExists) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Filesystem checkpoint is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      if (!toExists) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Filesystem checkpoint is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      const diff = yield* checkpointStore.diffCheckpoints({
        cwd: workspaceCwd,
        fromCheckpointRef,
        toCheckpointRef,
        fallbackFromToHead: false,
      });

      const scopedPaths = new Set(
        threadContext.value.checkpoints
          .filter(
            (checkpoint) =>
              checkpoint.checkpointTurnCount > input.fromTurnCount &&
              checkpoint.checkpointTurnCount <= input.toTurnCount,
          )
          .flatMap((checkpoint) => checkpoint.files.map((file) => file.path)),
      );
      const scopedDiff =
        scopedPaths.size > 0
          ? filterUnifiedDiffByPaths(diff, scopedPaths)
          : isWorkerScopedThread(threadContext.value)
            ? ""
            : diff;

      const turnDiff: OrchestrationGetTurnDiffResultType = {
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        diff: scopedDiff,
      };
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed turn diff result does not satisfy contract schema.",
        });
      }

      return turnDiff;
    },
  );

  const getFullThreadDiff: CheckpointDiffQueryShape["getFullThreadDiff"] = (
    input: OrchestrationGetFullThreadDiffInput,
  ) =>
    getTurnDiff({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.toTurnCount,
    }).pipe(Effect.map((result): OrchestrationGetFullThreadDiffResult => result));

  return {
    getTurnDiff,
    getFullThreadDiff,
  } satisfies CheckpointDiffQueryShape;
});

export const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make);
