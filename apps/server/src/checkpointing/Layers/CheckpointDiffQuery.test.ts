import { CheckpointRef, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  ProjectionSnapshotQuery,
  type ProjectionThreadCheckpointContext,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { checkpointRefForThreadTurn } from "../Utils.ts";
import { CheckpointDiffQueryLive } from "./CheckpointDiffQuery.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointDiffQuery } from "../Services/CheckpointDiffQuery.ts";

function makeThreadCheckpointContext(input: {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
  readonly role?: "default" | "manager" | "worker";
  readonly managerThreadId?: ThreadId | null;
  readonly files?: ReadonlyArray<{ readonly path: string }>;
}): ProjectionThreadCheckpointContext {
  return {
    threadId: input.threadId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    worktreePath: input.worktreePath,
    role: input.role ?? "default",
    managerThreadId: input.managerThreadId ?? null,
    checkpoints: [
      {
        turnId: TurnId.makeUnsafe("turn-1"),
        checkpointTurnCount: input.checkpointTurnCount,
        checkpointRef: input.checkpointRef,
        status: "ready",
        files: (input.files ?? []).map((file) => ({
          path: file.path,
          kind: "modified",
          additions: 0,
          deletions: 0,
        })),
        assistantMessageId: null,
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

describe("CheckpointDiffQueryLive", () => {
  it("computes diffs using canonical turn-0 checkpoint refs", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-1");
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
    const hasCheckpointRefCalls: Array<CheckpointRef> = [];
    const diffCheckpointsCalls: Array<{
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly cwd: string;
    }> = [];

    const threadCheckpointContext = makeThreadCheckpointContext({
      projectId,
      threadId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: ({ checkpointRef }) =>
        Effect.sync(() => {
          hasCheckpointRefCalls.push(checkpointRef);
          return true;
        }),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd }) =>
        Effect.sync(() => {
          diffCheckpointsCalls.push({ fromCheckpointRef, toCheckpointRef, cwd });
          return "diff patch";
        }),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
          getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer)),
    );

    const expectedFromRef = checkpointRefForThreadTurn(threadId, 0);
    expect(hasCheckpointRefCalls).toEqual([expectedFromRef, toCheckpointRef]);
    expect(diffCheckpointsCalls).toEqual([
      {
        cwd: "/tmp/workspace",
        fromCheckpointRef: expectedFromRef,
        toCheckpointRef,
      },
    ]);
    expect(result).toEqual({
      threadId,
      fromTurnCount: 0,
      toTurnCount: 1,
      diff: "diff patch",
    });
  });

  it("filters worker-scoped diffs to the checkpoint file set", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-worker");
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

    const threadCheckpointContext = makeThreadCheckpointContext({
      projectId,
      threadId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
      role: "worker",
      managerThreadId: ThreadId.makeUnsafe("thread-manager"),
      files: [{ path: "worker-only.ts" }],
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () =>
        Effect.succeed(
          [
            "diff --git a/worker-only.ts b/worker-only.ts",
            "index 1111111..2222222 100644",
            "--- a/worker-only.ts",
            "+++ b/worker-only.ts",
            "@@ -1 +1 @@",
            "-old",
            "+new",
            "diff --git a/leaked.ts b/leaked.ts",
            "index 3333333..4444444 100644",
            "--- a/leaked.ts",
            "+++ b/leaked.ts",
            "@@ -1 +1 @@",
            "-old leaked",
            "+new leaked",
            "",
          ].join("\n"),
        ),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
          getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.diff).toContain("worker-only.ts");
    expect(result.diff).not.toContain("leaked.ts");
  });

  it("returns an empty diff for scoped manager-worker threads with no scoped files", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-manager");
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

    const threadCheckpointContext = makeThreadCheckpointContext({
      projectId,
      threadId,
      workspaceRoot: "/tmp/workspace",
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
      role: "manager",
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed("diff --git a/leaked.ts b/leaked.ts\n"),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
          getThreadCheckpointContext: () => Effect.succeed(Option.some(threadCheckpointContext)),
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.diff).toBe("");
  });

  it("fails when the thread is missing from the snapshot", async () => {
    const threadId = ThreadId.makeUnsafe("thread-missing");

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed(""),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionSnapshotQuery, {
          getSnapshot: () =>
            Effect.die("CheckpointDiffQuery should not request the full orchestration snapshot"),
          getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
          getThreadCheckpointContext: () => Effect.succeed(Option.none()),
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery;
          return yield* query.getTurnDiff({
            threadId,
            fromTurnCount: 0,
            toTurnCount: 1,
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("Thread 'thread-missing' not found.");
  });
});
