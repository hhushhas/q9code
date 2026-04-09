import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CommandId, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import {
  extractManagerInternalAlert,
  WORKER_FINAL_CLOSE_TAG,
  WORKER_FINAL_OPEN_TAG,
} from "@t3tools/shared/manager";
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

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000) {
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
    expect(workers[0]?.modelSelection).toEqual({
      provider: "codex",
      model: "gpt-5.4",
    });

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

  it("does not wake the manager for ordinary worker assistant responses", async () => {
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
          model: "gpt-5.4",
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

    await new Promise((resolve) => setTimeout(resolve, 50));

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(
      (manager?.activities ?? []).some((activity) => activity.kind === "manager.worker.completed"),
    ).toBe(false);
    expect(
      (manager?.messages ?? []).some(
        (message) => message.role === "user" && extractManagerInternalAlert(message.text),
      ),
    ).toBe(false);

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
        fs
          .readFileSync(logPath, "utf8")
          .includes('Worker result from "Reconnect worker": Reconnect flow patched and verified.'),
    );
    expect(fs.readFileSync(logPath, "utf8")).toContain(
      'Worker result from "Reconnect worker": Reconnect flow patched and verified.',
    );
  });

  it("records tagged worker finals back onto the manager thread activity log", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-worker-reactor-final"),
        threadId: ThreadId.makeUnsafe("thread-worker-final"),
        projectId: asProjectId("project-1"),
        title: "Reconnect worker",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
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
        commandId: CommandId.makeUnsafe("cmd-worker-assistant-delta-final"),
        threadId: ThreadId.makeUnsafe("thread-worker-final"),
        messageId: asMessageId("assistant-message-worker-final"),
        delta: [
          "Progress note before the final handoff.",
          "",
          WORKER_FINAL_OPEN_TAG,
          "Reconnect flow patched and verified.",
          WORKER_FINAL_CLOSE_TAG,
        ].join("\n"),
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-worker-assistant-complete-final"),
        threadId: ThreadId.makeUnsafe("thread-worker-final"),
        messageId: asMessageId("assistant-message-worker-final"),
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
    const managerAlertMessage = [...(manager?.messages ?? [])]
      .toReversed()
      .find((message) => message.role === "user" && extractManagerInternalAlert(message.text));
    expect(managerAlertMessage).toBeDefined();
    expect(
      extractManagerInternalAlert(managerAlertMessage?.text ?? "")?.alerts[0]?.workerTitle,
    ).toBe("Reconnect worker");
  });

  it("queues manager alerts until the manager is ready to respond again", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-manager-session-running"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-manager"),
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.makeUnsafe("turn-manager-active"),
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-worker-queued"),
        threadId: ThreadId.makeUnsafe("thread-worker-queued"),
        projectId: asProjectId("project-1"),
        title: "Queued worker",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
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
        commandId: CommandId.makeUnsafe("cmd-queued-worker-assistant-delta"),
        threadId: ThreadId.makeUnsafe("thread-worker-queued"),
        messageId: asMessageId("assistant-message-worker-queued"),
        delta: [
          WORKER_FINAL_OPEN_TAG,
          "Queued worker finished its task.",
          WORKER_FINAL_CLOSE_TAG,
        ].join("\n"),
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-queued-worker-assistant-complete"),
        threadId: ThreadId.makeUnsafe("thread-worker-queued"),
        messageId: asMessageId("assistant-message-worker-queued"),
        createdAt,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const beforeReadyReadModel = await Effect.runPromise(harness.engine.getReadModel());
    const managerWhileBusy = beforeReadyReadModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(
      (managerWhileBusy?.messages ?? []).some(
        (message) => message.role === "user" && extractManagerInternalAlert(message.text),
      ),
    ).toBe(false);

    const readyAt = new Date(Date.now() + 1_000).toISOString();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-manager-session-ready"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-manager"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: readyAt,
        },
        createdAt: readyAt,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const manager = readModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return (manager?.messages ?? []).some(
        (message) => message.role === "user" && extractManagerInternalAlert(message.text),
      );
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    const managerAlertMessage = [...(manager?.messages ?? [])]
      .toReversed()
      .find((message) => message.role === "user" && extractManagerInternalAlert(message.text));
    expect(
      extractManagerInternalAlert(managerAlertMessage?.text ?? "")?.alerts[0]?.workerTitle,
    ).toBe("Queued worker");
  });
});
