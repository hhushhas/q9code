import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CommandId, EventId, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import {
  extractManagerInternalAlert,
  WORKER_BLOCKED_CLOSE_TAG,
  WORKER_BLOCKED_OPEN_TAG,
  WORKER_COMPLETE_CLOSE_TAG,
  WORKER_COMPLETE_OPEN_TAG,
} from "@t3tools/shared/manager";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
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

    const readModel = await Effect.runPromise(engine.getReadModel());
    const managerThread = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );

    return {
      engine,
      workspaceRoot,
      managerScratchpad: managerThread?.managerScratchpad ?? null,
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
      const manager = readModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return (
        readModel.threads.filter(
          (thread) => thread.managerThreadId === ThreadId.makeUnsafe("thread-manager"),
        ).length === 1 &&
        manager?.activities.some((activity) => activity.kind === "manager.worker.launched") === true
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

    const logPath = harness.managerScratchpad?.sessionLogPath ?? "";
    await waitFor(
      async () =>
        logPath.length > 0 &&
        fs.existsSync(logPath) &&
        fs.readFileSync(logPath, "utf8").includes("Manager delegated 1 worker.") &&
        fs.readFileSync(logPath, "utf8").includes("Worker created: Reconnect patch"),
    );
    const logContents = fs.readFileSync(logPath, "utf8");
    expect(logContents).toContain("Manager delegated 1 worker.");
    expect(logContents).toContain("Worker created: Reconnect patch");
    const workerLogPath = path.join(
      harness.managerScratchpad?.folderPath ?? "",
      "workers",
      `${workers[0]?.id}.md`,
    );
    expect(fs.existsSync(workerLogPath)).toBe(true);
    expect(fs.readFileSync(workerLogPath, "utf8")).toContain(
      'Worker thread created as "Reconnect patch".',
    );
  });

  it("preserves explicit worker model selection from manager delegation manifests", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-manager-turn-start-model-selection"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        message: {
          messageId: asMessageId("user-message-manager-model-selection"),
          role: "user",
          text: "Launch a support worker to search reconnect regressions.",
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
        commandId: CommandId.makeUnsafe("cmd-manager-assistant-delta-model-selection"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        messageId: asMessageId("assistant-message-manager-model-selection"),
        delta: [
          "Delegating a support search worker.",
          "<manager_delegation>",
          JSON.stringify({
            summary: "Use the cheaper support worker for the codebase sweep.",
            workers: [
              {
                id: "support-search",
                title: "Support search",
                prompt:
                  "Search the codebase for websocket reconnect regressions and summarize them.",
                modelSelection: {
                  provider: "codex",
                  model: "gpt-5.4-mini",
                  options: {
                    reasoningEffort: "medium",
                    fastMode: true,
                  },
                },
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
        commandId: CommandId.makeUnsafe("cmd-manager-assistant-complete-model-selection"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        messageId: asMessageId("assistant-message-manager-model-selection"),
        createdAt,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const manager = readModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return (
        readModel.threads.filter(
          (thread) => thread.managerThreadId === ThreadId.makeUnsafe("thread-manager"),
        ).length === 1 &&
        manager?.activities.some((activity) => activity.kind === "manager.worker.launched") === true
      );
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const worker = readModel.threads.find(
      (thread) => thread.managerThreadId === ThreadId.makeUnsafe("thread-manager"),
    );

    expect(worker?.modelSelection).toEqual({
      provider: "codex",
      model: "gpt-5.4-mini",
      options: {
        reasoningEffort: "medium",
        fastMode: true,
      },
    });

    const manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    const launchActivity = manager?.activities.find(
      (activity) => activity.kind === "manager.worker.launched",
    );
    expect(launchActivity).toBeDefined();
    expect(launchActivity?.payload).toMatchObject({
      workerId: "support-search",
      workerTitle: "Support search",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4-mini",
        options: {
          reasoningEffort: "medium",
          fastMode: true,
        },
      },
    });
  });

  it("records dependency waiting cards and auto-starts workers after dependencies clear", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-manager-turn-start-with-dependencies"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        message: {
          messageId: asMessageId("user-message-manager-dependencies"),
          role: "user",
          text: "Coordinate implementation and release.",
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
        commandId: CommandId.makeUnsafe("cmd-manager-assistant-delta-with-dependencies"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        messageId: asMessageId("assistant-message-manager-dependencies"),
        delta: [
          "Delegating implementation and release.",
          "<manager_delegation>",
          JSON.stringify({
            summary: "Implementation first, then release.",
            workers: [
              {
                id: "implement",
                title: "Implement",
                prompt: "Land the fix.",
              },
              {
                id: "release",
                title: "Release",
                prompt: "Ship after implementation is done.",
                kind: "release",
                dependsOn: ["implement"],
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
        commandId: CommandId.makeUnsafe("cmd-manager-assistant-complete-with-dependencies"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        messageId: asMessageId("assistant-message-manager-dependencies"),
        createdAt,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const manager = readModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return (manager?.activities ?? []).some(
        (activity) => activity.kind === "manager.worker.waiting-on-dependencies",
      );
    });

    let readModel = await Effect.runPromise(harness.engine.getReadModel());
    let manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    const implementLaunch = (manager?.activities ?? []).find(
      (activity) => activity.kind === "manager.worker.launched",
    );
    const releaseWaiting = (manager?.activities ?? []).find(
      (activity) => activity.kind === "manager.worker.waiting-on-dependencies",
    );
    expect(implementLaunch?.payload).toMatchObject({
      workerId: "implement",
      workerTitle: "Implement",
    });
    expect(releaseWaiting?.payload).toMatchObject({
      workerId: "release",
      workerTitle: "Release",
      blockingWorkerIds: ["implement"],
    });

    const implementThreadId = (
      implementLaunch?.payload as { workerThreadId?: ThreadId } | undefined
    )?.workerThreadId;
    expect(implementThreadId).toBeDefined();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: CommandId.makeUnsafe("cmd-implement-worker-complete-delta"),
        threadId: implementThreadId!,
        messageId: asMessageId("assistant-message-implement-worker"),
        delta: [
          WORKER_COMPLETE_OPEN_TAG,
          "Implementation shipped.",
          WORKER_COMPLETE_CLOSE_TAG,
        ].join("\n"),
        createdAt: new Date(Date.now() + 500).toISOString(),
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-implement-worker-complete"),
        threadId: implementThreadId!,
        messageId: asMessageId("assistant-message-implement-worker"),
        createdAt: new Date(Date.now() + 500).toISOString(),
      }),
    );

    await waitFor(async () => {
      const nextReadModel = await Effect.runPromise(harness.engine.getReadModel());
      const nextManager = nextReadModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return (nextManager?.activities ?? []).some(
        (activity) => activity.kind === "manager.worker.auto-started",
      );
    });

    readModel = await Effect.runPromise(harness.engine.getReadModel());
    manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    const releaseAutoStarted = (manager?.activities ?? []).find(
      (activity) => activity.kind === "manager.worker.auto-started",
    );
    expect(releaseAutoStarted?.payload).toMatchObject({
      workerId: "release",
      workerTitle: "Release",
      triggeringWorkerIds: ["implement"],
    });
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

    const logPath = harness.managerScratchpad?.sessionLogPath ?? "";
    await waitFor(
      async () =>
        logPath.length > 0 &&
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
          WORKER_COMPLETE_OPEN_TAG,
          "Reconnect flow patched and verified.",
          WORKER_COMPLETE_CLOSE_TAG,
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

  it("records blocked worker outcomes separately from runtime session state", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-worker-reactor-blocked"),
        threadId: ThreadId.makeUnsafe("thread-worker-blocked"),
        projectId: asProjectId("project-1"),
        title: "Blocked worker",
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
        commandId: CommandId.makeUnsafe("cmd-worker-assistant-delta-blocked"),
        threadId: ThreadId.makeUnsafe("thread-worker-blocked"),
        messageId: asMessageId("assistant-message-worker-blocked"),
        delta: [
          WORKER_BLOCKED_OPEN_TAG,
          "I need the manager to choose whether this should interrupt the running worker.",
          WORKER_BLOCKED_CLOSE_TAG,
        ].join("\n"),
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.makeUnsafe("cmd-worker-assistant-complete-blocked"),
        threadId: ThreadId.makeUnsafe("thread-worker-blocked"),
        messageId: asMessageId("assistant-message-worker-blocked"),
        createdAt,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const manager = readModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return (manager?.activities ?? []).some(
        (activity) =>
          activity.kind === "manager.worker.blocked" &&
          activity.summary.includes("reported a blocker"),
      );
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(
      (manager?.activities ?? []).some(
        (activity) =>
          activity.kind === "manager.worker.blocked" &&
          activity.summary.includes("reported a blocker"),
      ),
    ).toBe(true);
    const managerAlertMessage = [...(manager?.messages ?? [])]
      .toReversed()
      .find((message) => message.role === "user" && extractManagerInternalAlert(message.text));
    expect(extractManagerInternalAlert(managerAlertMessage?.text ?? "")?.alerts[0]?.kind).toBe(
      "worker.blocked",
    );
  });

  it("renames the sacred manager folder when the manager title changes", async () => {
    const harness = await createHarness();
    const beforeRenamePath = harness.managerScratchpad?.sessionLogPath ?? "";
    await waitFor(async () => beforeRenamePath.length > 0 && fs.existsSync(beforeRenamePath));

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("cmd-thread-meta-update-manager-rename"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        title: "Beacon coordinator",
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const manager = readModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      const nextLogPath = manager?.managerScratchpad?.sessionLogPath ?? "";
      return (
        nextLogPath.length > 0 && fs.existsSync(nextLogPath) && !fs.existsSync(beforeRenamePath)
      );
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(manager?.title).toBe("Beacon coordinator");
    expect(manager?.managerScratchpad?.folderPath).toBe(
      path.join(harness.workspaceRoot, "scratchpad", "beacon-coordinator"),
    );
    expect(fs.readFileSync(manager?.managerScratchpad?.sessionLogPath ?? "", "utf8")).toContain(
      'Manager renamed to "Beacon coordinator".',
    );
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
          WORKER_COMPLETE_OPEN_TAG,
          "Queued worker finished its task.",
          WORKER_COMPLETE_CLOSE_TAG,
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

  it("interrupts a running worker before sending manager follow-up input", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-worker-manager-input"),
        threadId: ThreadId.makeUnsafe("thread-worker-input"),
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
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-thread-session-set-worker-manager-input"),
        threadId: ThreadId.makeUnsafe("thread-worker-input"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-worker-input"),
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.makeUnsafe("turn-worker-running"),
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "manager.worker.input.send",
        commandId: CommandId.makeUnsafe("cmd-manager-worker-input-send"),
        managerThreadId: ThreadId.makeUnsafe("thread-manager"),
        workerThreadId: ThreadId.makeUnsafe("thread-worker-input"),
        input: {
          messageId: asMessageId("msg-manager-worker-input"),
          text: "Stop the current attempt and focus on websocket reconnects.",
          attachments: [],
        },
        mode: "interrupt",
        createdAt,
      }),
    );

    await waitFor(async () => {
      const events = (await Effect.runPromise(
        Stream.runCollect(harness.engine.readEvents(0)).pipe(
          Effect.map((entries) => Array.from(entries) as Array<{ type: string; payload: any }>),
        ),
      )) as Array<{ type: string; payload: any }>;
      return events.some((event) => event.type === "thread.turn-interrupt-requested");
    });

    const events = (await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((entries) => Array.from(entries) as Array<{ type: string; payload: any }>),
      ),
    )) as Array<{ type: string; payload: any }>;
    expect(events.some((event) => event.type === "manager.worker-input-requested")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "thread.turn-interrupt-requested" &&
          event.payload.threadId === ThreadId.makeUnsafe("thread-worker-input"),
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "thread.turn-start-requested" &&
          event.payload.threadId === ThreadId.makeUnsafe("thread-worker-input") &&
          event.payload.messageId === asMessageId("msg-manager-worker-input"),
      ),
    ).toBe(true);

    const logPath = harness.managerScratchpad?.sessionLogPath ?? "";
    await waitFor(
      async () =>
        fs.existsSync(logPath) &&
        fs
          .readFileSync(logPath, "utf8")
          .includes('Manager sent input to worker "Reconnect worker"') &&
        fs.readFileSync(logPath, "utf8").includes("Mode: interrupt"),
    );

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(
      (manager?.activities ?? []).some((activity) => activity.kind === "manager.worker.input.sent"),
    ).toBe(true);
    expect(
      (manager?.activities ?? []).some((activity) => activity.kind === "manager.worker.input.mode"),
    ).toBe(true);
  });

  it("queues manager follow-up input for non-running workers without emitting an interrupt", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-worker-manager-queue"),
        threadId: ThreadId.makeUnsafe("thread-worker-queue"),
        projectId: asProjectId("project-1"),
        title: "Idle worker",
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
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-thread-session-set-worker-manager-queue"),
        threadId: ThreadId.makeUnsafe("thread-worker-queue"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-worker-queue"),
          status: "stopped",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "manager.worker.input.send",
        commandId: CommandId.makeUnsafe("cmd-manager-worker-queue-send"),
        managerThreadId: ThreadId.makeUnsafe("thread-manager"),
        workerThreadId: ThreadId.makeUnsafe("thread-worker-queue"),
        input: {
          messageId: asMessageId("msg-manager-worker-queue"),
          text: "Pick up from the last checkpoint and continue with the retry fix.",
          attachments: [],
        },
        mode: "queue",
        createdAt,
      }),
    );

    await waitFor(async () => {
      const events = (await Effect.runPromise(
        Stream.runCollect(harness.engine.readEvents(0)).pipe(
          Effect.map((entries) => Array.from(entries) as Array<{ type: string; payload: any }>),
        ),
      )) as Array<{ type: string; payload: any }>;
      return events.some(
        (event) =>
          event.type === "thread.turn-start-requested" &&
          event.payload.messageId === asMessageId("msg-manager-worker-queue"),
      );
    });

    const events = (await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((entries) => Array.from(entries) as Array<{ type: string; payload: any }>),
      ),
    )) as Array<{ type: string; payload: any }>;
    expect(
      events.some(
        (event) =>
          event.type === "thread.turn-start-requested" &&
          event.payload.threadId === ThreadId.makeUnsafe("thread-worker-queue"),
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "thread.turn-interrupt-requested" &&
          event.payload.threadId === ThreadId.makeUnsafe("thread-worker-queue"),
      ),
    ).toBe(false);

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const manager = readModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return (manager?.activities ?? []).some(
        (activity) => activity.kind === "manager.worker.input.mode",
      );
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const manager = readModel.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    const inputModeActivity = (manager?.activities ?? []).find(
      (activity) => activity.kind === "manager.worker.input.mode",
    );
    expect(inputModeActivity?.payload).toMatchObject({
      requestedMode: "queue",
      effectiveMode: "queue",
    });
  });

  it("records dedicated manager cards for approval, input, and failure worker states", async () => {
    const harness = await createHarness();
    const createdAt = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-worker-state-cards"),
        threadId: ThreadId.makeUnsafe("thread-worker-state-cards"),
        projectId: asProjectId("project-1"),
        title: "State cards worker",
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
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe("cmd-worker-approval-requested"),
        threadId: ThreadId.makeUnsafe("thread-worker-state-cards"),
        activity: {
          id: EventId.makeUnsafe("activity-worker-approval-requested"),
          tone: "approval",
          kind: "approval.requested",
          summary: "Command approval requested",
          payload: {
            requestId: "req-approval-1",
            requestKind: "command",
            detail: "Deploy the release build.",
          },
          turnId: null,
          createdAt,
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe("cmd-worker-user-input-requested"),
        threadId: ThreadId.makeUnsafe("thread-worker-state-cards"),
        activity: {
          id: EventId.makeUnsafe("activity-worker-user-input-requested"),
          tone: "info",
          kind: "user-input.requested",
          summary: "Need release window",
          payload: {
            requestId: "req-input-1",
            questions: [
              {
                id: "window",
                header: "Window",
                question: "Which rollout window should I use?",
                options: [{ label: "Now", description: "Ship immediately." }],
              },
            ],
          },
          turnId: null,
          createdAt: new Date(Date.now() + 100).toISOString(),
        },
        createdAt: new Date(Date.now() + 100).toISOString(),
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe("cmd-worker-runtime-error"),
        threadId: ThreadId.makeUnsafe("thread-worker-state-cards"),
        activity: {
          id: EventId.makeUnsafe("activity-worker-runtime-error"),
          tone: "error",
          kind: "runtime.error",
          summary: "Provider crashed while packaging the release.",
          payload: {},
          turnId: null,
          createdAt: new Date(Date.now() + 200).toISOString(),
        },
        createdAt: new Date(Date.now() + 200).toISOString(),
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const manager = readModel.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return (
        (manager?.activities ?? []).some(
          (activity) => activity.kind === "manager.worker.needs-approval",
        ) &&
        (manager?.activities ?? []).some(
          (activity) => activity.kind === "manager.worker.needs-input",
        ) &&
        (manager?.activities ?? []).some((activity) => activity.kind === "manager.worker.failed")
      );
    });
  });
});
