import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CommandId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { ManagerThreadReactorLive } from "./ManagerThreadReactor.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ScheduledMessageReactorLive } from "./ScheduledMessageReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ManagerThreadReactor } from "../Services/ManagerThreadReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ScheduledMessageReactor } from "../Services/ScheduledMessageReactor.ts";

const asProjectId = (value: string) => value as never;

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for scheduled-message state.");
}

describe("ScheduledMessageReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    | OrchestrationEngineService
    | ScheduledMessageReactor
    | ManagerThreadReactor
    | ProjectionSnapshotQuery,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const tempDirs: string[] = [];

  const makeTempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-scheduled-reactor-"));
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
    const persistenceLayer = SqlitePersistenceMemory;
    const projectionSnapshotQueryLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provideMerge(persistenceLayer),
    );
    const orchestrationEngineLayer = OrchestrationEngineLive.pipe(
      Layer.provide(projectionSnapshotQueryLayer),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(persistenceLayer),
    );
    const orchestrationLayer = Layer.mergeAll(
      projectionSnapshotQueryLayer,
      orchestrationEngineLayer,
    );
    const layer = ScheduledMessageReactorLive.pipe(
      Layer.provideMerge(ManagerThreadReactorLive),
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-scheduled-reactor-test-" }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const scheduledReactor = await runtime.runPromise(Effect.service(ScheduledMessageReactor));
    const managerReactor = await runtime.runPromise(Effect.service(ManagerThreadReactor));
    scope = await Effect.runPromise(Scope.make());

    const createdAt = new Date().toISOString();
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-create-scheduled-reactor"),
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
        commandId: CommandId.makeUnsafe("cmd-thread-create-manager-scheduled-reactor"),
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
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create-worker-scheduled-reactor"),
        threadId: ThreadId.makeUnsafe("thread-worker"),
        projectId: asProjectId("project-1"),
        title: "Reconnect patch",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        managerThreadId: ThreadId.makeUnsafe("thread-manager"),
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    return {
      engine,
      scheduledReactor,
      managerReactor,
    };
  }

  it("creates a pending scheduled message and delivers it to the manager thread", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.scheduledReactor.start().pipe(Scope.provide(scope!)));

    const scheduledFor = new Date(Date.now() + 50).toISOString();
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.scheduled-message.schedule",
        commandId: CommandId.makeUnsafe("cmd-schedule-manager-message"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        scheduledMessageId: "scheduled-manager-1" as never,
        content: "Check the release checklist.",
        scheduledFor,
        target: { kind: "manager" },
        deliveryMode: "queue",
        createdAt: new Date().toISOString(),
      }),
    );

    let snapshot = await Effect.runPromise(harness.engine.getReadModel());
    expect(
      snapshot.threads.find((thread) => thread.id === ThreadId.makeUnsafe("thread-manager"))
        ?.scheduledMessages[0]?.status,
    ).toBe("pending");

    await waitFor(async () => {
      await Effect.runPromise(harness.scheduledReactor.drain);
      const current = await Effect.runPromise(harness.engine.getReadModel());
      const manager = current.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return manager?.scheduledMessages[0]?.status === "delivered";
    }, 10_000);

    snapshot = await Effect.runPromise(harness.engine.getReadModel());
    const managerThread = snapshot.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(
      managerThread?.messages.some((message) => message.text === "Check the release checklist."),
    ).toBe(true);
    expect(managerThread?.scheduledMessages[0]?.status).toBe("delivered");
  });

  it("cancels a pending scheduled message before it fires", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.scheduledReactor.start().pipe(Scope.provide(scope!)));

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.scheduled-message.schedule",
        commandId: CommandId.makeUnsafe("cmd-schedule-manager-cancel"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        scheduledMessageId: "scheduled-manager-cancel" as never,
        content: "Do not deliver this.",
        scheduledFor: new Date(Date.now() + 250).toISOString(),
        target: { kind: "manager" },
        deliveryMode: "queue",
        createdAt: new Date().toISOString(),
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.scheduled-message.cancel",
        commandId: CommandId.makeUnsafe("cmd-cancel-manager-message"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        scheduledMessageId: "scheduled-manager-cancel" as never,
        createdAt: new Date().toISOString(),
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 350));

    const snapshot = await Effect.runPromise(harness.engine.getReadModel());
    const managerThread = snapshot.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(managerThread?.scheduledMessages[0]?.status).toBe("cancelled");
    expect(managerThread?.messages.some((message) => message.text === "Do not deliver this.")).toBe(
      false,
    );
  });

  it("reschedules and edits a pending scheduled message before delivery", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.scheduledReactor.start().pipe(Scope.provide(scope!)));

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.scheduled-message.schedule",
        commandId: CommandId.makeUnsafe("cmd-schedule-update"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        scheduledMessageId: "scheduled-manager-update" as never,
        content: "Old message body",
        scheduledFor: new Date(Date.now() + 500).toISOString(),
        target: { kind: "manager" },
        deliveryMode: "queue",
        createdAt: new Date().toISOString(),
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.scheduled-message.update",
        commandId: CommandId.makeUnsafe("cmd-update-manager-message"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        scheduledMessageId: "scheduled-manager-update" as never,
        content: "Updated follow-up",
        scheduledFor: new Date(Date.now() + 50).toISOString(),
        target: { kind: "manager" },
        deliveryMode: "queue",
        createdAt: new Date().toISOString(),
      }),
    );

    await waitFor(async () => {
      const current = await Effect.runPromise(harness.engine.getReadModel());
      const manager = current.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return manager?.scheduledMessages[0]?.status === "delivered";
    });

    const snapshot = await Effect.runPromise(harness.engine.getReadModel());
    const managerThread = snapshot.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(managerThread?.messages.some((message) => message.text === "Updated follow-up")).toBe(
      true,
    );
  });

  it("interrupts a running worker before delivering an interrupt-mode scheduled follow-up", async () => {
    const harness = await createHarness();
    await Effect.runPromise(harness.managerReactor.start().pipe(Scope.provide(scope!)));
    await Effect.runPromise(harness.scheduledReactor.start().pipe(Scope.provide(scope!)));

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("cmd-worker-running-session"),
        threadId: ThreadId.makeUnsafe("thread-worker"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-worker"),
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: "turn-running" as never,
          lastError: null,
          updatedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.scheduled-message.schedule",
        commandId: CommandId.makeUnsafe("cmd-schedule-worker-interrupt"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        scheduledMessageId: "scheduled-worker-interrupt" as never,
        content: "Please stop and prioritize the blocker.",
        scheduledFor: new Date(Date.now() + 50).toISOString(),
        target: { kind: "worker", workerThreadId: ThreadId.makeUnsafe("thread-worker") },
        deliveryMode: "interrupt",
        createdAt: new Date().toISOString(),
      }),
    );

    await waitFor(async () => {
      const current = await Effect.runPromise(harness.engine.getReadModel());
      const worker = current.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-worker"),
      );
      return (
        worker?.messages.some(
          (message) =>
            message.role === "user" && message.text === "Please stop and prioritize the blocker.",
        ) ?? false
      );
    });

    const events = await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    expect(
      events.some(
        (event) =>
          event.type === "thread.turn-interrupt-requested" &&
          event.payload.threadId === ThreadId.makeUnsafe("thread-worker"),
      ),
    ).toBe(true);
  });

  it("delivers overdue scheduled messages immediately on startup and marks them as delayed recovery", async () => {
    const harness = await createHarness();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.scheduled-message.schedule",
        commandId: CommandId.makeUnsafe("cmd-schedule-recovery"),
        threadId: ThreadId.makeUnsafe("thread-manager"),
        scheduledMessageId: "scheduled-recovery" as never,
        content: "Recover this missed follow-up.",
        scheduledFor: new Date(Date.now() - 5_000).toISOString(),
        target: { kind: "manager" },
        deliveryMode: "queue",
        createdAt: new Date(Date.now() - 10_000).toISOString(),
      }),
    );

    await Effect.runPromise(harness.scheduledReactor.start().pipe(Scope.provide(scope!)));

    await waitFor(async () => {
      const current = await Effect.runPromise(harness.engine.getReadModel());
      const manager = current.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
      );
      return manager?.scheduledMessages[0]?.delayedDueToRecovery === true;
    });

    const snapshot = await Effect.runPromise(harness.engine.getReadModel());
    const managerThread = snapshot.threads.find(
      (thread) => thread.id === ThreadId.makeUnsafe("thread-manager"),
    );
    expect(managerThread?.scheduledMessages[0]?.status).toBe("delivered");
    expect(managerThread?.scheduledMessages[0]?.delayedDueToRecovery).toBe(true);
    expect(
      managerThread?.messages.some((message) => message.text === "Recover this missed follow-up."),
    ).toBe(true);
  });
});
