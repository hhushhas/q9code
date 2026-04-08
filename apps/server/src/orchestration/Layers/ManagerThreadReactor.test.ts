import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ManagerThreadReactorLive } from "./ManagerThreadReactor.ts";
import { ManagerThreadReactor } from "../Services/ManagerThreadReactor.ts";

const asProjectId = (value: string) => value as never;
const asMessageId = (value: string) => MessageId.makeUnsafe(value);

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for manager reactor state.");
}

describe("ManagerThreadReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | ManagerThreadReactor,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const tempDirs: string[] = [];

  const makeTempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-manager-reactor-"));
    tempDirs.push(dir);
    return dir;
  };

  const cleanup = async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  afterEach(async () => {
    await cleanup();
  });

  async function createHarness() {
    const workspaceRoot = makeTempDir();
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );
    const layer = ManagerThreadReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-manager-reactor-test-" }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const reactor = await runtime.runPromise(Effect.service(ManagerThreadReactor));
    scope = await Effect.runPromise(Scope.make());
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));

    const createdAt = new Date().toISOString();
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-create-manager-reactor"),
        projectId: asProjectId("project-1"),
        title: "Q9 Code",
        workspaceRoot,
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-manager-reactor"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        projectId: asProjectId("project-1"),
        title: "Project manager",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        role: "manager",
        interactionMode: "plan",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    return {
      engine,
      workspaceRoot,
    };
  }

  it("creates sacred manager logs and auto-launches workers from manager delegation replies", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-manager-turn-start"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        message: {
          messageId: asMessageId("user-message-manager"),
          role: "user",
          text: "Fix reconnects by delegating a worker.",
          attachments: [],
        },
        interactionMode: "plan",
        runtimeMode: "full-access",
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: CommandId.makeUnsafe("cmd-manager-assistant-delta"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        messageId: asMessageId("assistant-message-manager"),
        delta: [
          "Delegating the reconnect patch.",
          "<manager_delegation>",
          JSON.stringify({
            summary: "One worker is enough here.",
            workers: [
              {
                title: "Reconnect patch",
                prompt: "Implement the reconnect fix and verify it.",
              },
            ],
          }),
          "</manager_delegation>",
        ].join("\n"),
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-manager-assistant-complete"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        messageId: asMessageId("assistant-message-manager"),
        createdAt,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      return (
        readModel.threads.filter(
          (thread) => thread.managerThreadId === ThreadId.makeUnsafe("thread-manager"),
        ).length === 1
      );
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const workers = readModel.threads.filter(
      (thread) => thread.managerThreadId === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(workers).toHaveLength(1);
    expect(workers[0]?.title).toBe("Reconnect patch");

    const logPath = path.join(
      harness.workspaceRoot,
      "scratchpad",
      "managers",
      path.basename(harness.workspaceRoot),
      "manager-session-log.md",
    );
    await waitFor(
      async () =>
        fs.existsSync(logPath) &&
        fs.readFileSync(logPath, "utf8").includes("Manager delegated 1 worker.") &&
        fs.readFileSync(logPath, "utf8").includes("Worker created: Reconnect patch"),
    );
    const logContents = fs.readFileSync(logPath, "utf8");
    expect(logContents).toContain("Manager delegated 1 worker.");
    expect(logContents).toContain("Worker created: Reconnect patch");
  });

  it("records worker completions back onto the manager thread activity log", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-worker-reactor"),
        threadId: ThreadId.makeUnsafe("thread-worker"),
        projectId: asProjectId("project-1"),
        title: "Reconnect worker",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        role: "worker",
        managerThreadId: ThreadId.makeUnsafe("thread-manager"),
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: CommandId.makeUnsafe("cmd-worker-assistant-delta"),
        threadId: ThreadId.makeUnsafe("thread-worker"),
        messageId: asMessageId("assistant-message-worker"),
        delta: "Reconnect flow patched and verified.",
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-worker-assistant-complete"),
        threadId: ThreadId.makeUnsafe("thread-worker"),
        messageId: asMessageId("assistant-message-worker"),
        createdAt,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const manager = readModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return (manager?.activities ?? []).some(
        (activity) => activity.kind === "manager.worker.completed",
      );
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(
      (manager?.activities ?? []).some((activity) => activity.kind === "manager.worker.completed"),
    ).toBe(true);
  });
});
