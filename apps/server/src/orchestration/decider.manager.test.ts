import { CommandId, EventId, ProjectId, ThreadId } from "@t3tools/contracts";
import { pickDefaultManagerThreadTitle } from "@t3tools/shared/manager";
import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

describe("decider manager threads", () => {
  it("builds manager scratchpad metadata for manager thread creation", async () => {
    const now = "2026-04-08T08:00:00.000Z";
    const initial = createEmptyReadModel(now);
    const readModel = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-created-manager"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-created-manager"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-created-manager"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Q9 Code",
          workspaceRoot: "/tmp/q9-code",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-create-manager"),
          threadId: asThreadId("thread-manager"),
          projectId: asProjectId("project-1"),
          title: "Project manager",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          role: "manager",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    const expectedTitle = pickDefaultManagerThreadTitle(
      "project-1:thread-manager:2026-04-08T08:00:00.000Z",
    );
    const expectedSlug = `${expectedTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}-thread-manager`;
    expect(event.type).toBe("thread.created");
    expect(event.payload.title).toBe(expectedTitle);
    expect("managerScratchpad" in event.payload && event.payload.managerScratchpad).toEqual({
      folderPath: `/tmp/q9-code/scratchpad/${expectedSlug}`,
      sessionLogPath: `/tmp/q9-code/scratchpad/${expectedSlug}/manager-session-log.md`,
    });
  });

  it("allows creating multiple manager threads for the same project", async () => {
    const now = "2026-04-08T08:00:00.000Z";
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-created-manager-duplicate"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-created-manager-duplicate"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-created-manager-duplicate"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Q9 Code",
          workspaceRoot: "/tmp/q9-code",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const withManager = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-created-manager-duplicate"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-manager-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-created-manager-duplicate"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-created-manager-duplicate"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-manager-1"),
          projectId: asProjectId("project-1"),
          title: "Project manager",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          role: "manager",
          managerScratchpad: {
            folderPath: "/tmp/q9-code/scratchpad/atlas-coordinator",
            sessionLogPath: "/tmp/q9-code/scratchpad/atlas-coordinator/manager-session-log.md",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-create-manager-2"),
          threadId: asThreadId("thread-manager-2"),
          projectId: asProjectId("project-1"),
          title: "Second manager",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          role: "manager",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        readModel: withManager,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event.type).toBe("thread.created");
    expect(event.payload.threadId).toBe(asThreadId("thread-manager-2"));
    expect(event.payload.role).toBe("manager");
    expect(event.payload.managerScratchpad).toEqual({
      folderPath: "/tmp/q9-code/scratchpad/second-manager-thread-manager-2",
      sessionLogPath:
        "/tmp/q9-code/scratchpad/second-manager-thread-manager-2/manager-session-log.md",
    });
  });

  it("forces manager threads onto the coordinator model and default interaction mode", async () => {
    const now = "2026-04-08T08:00:00.000Z";
    const initial = createEmptyReadModel(now);
    const readModel = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-created-manager-coordinator"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-created-manager-coordinator"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-created-manager-coordinator"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Q9 Code",
          workspaceRoot: "/tmp/q9-code",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-create-manager-coordinator"),
          threadId: asThreadId("thread-manager"),
          projectId: asProjectId("project-1"),
          title: "Project manager",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          role: "manager",
          runtimeMode: "full-access",
          interactionMode: "plan",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("thread.created");
    expect(event.payload.modelSelection).toEqual({
      provider: "codex",
      model: "gpt-5.4",
    });
    expect(event.payload.interactionMode).toBe("default");
  });

  it("recomputes scratchpad metadata when a manager thread is renamed", async () => {
    const now = "2026-04-08T08:00:00.000Z";
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-created-manager-rename"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-created-manager-rename"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-created-manager-rename"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Q9 Code",
          workspaceRoot: "/tmp/q9-code",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const withManager = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-created-manager-rename"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-manager"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-created-manager-rename"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-created-manager-rename"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-manager"),
          projectId: asProjectId("project-1"),
          title: "Atlas coordinator",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          role: "manager",
          managerScratchpad: {
            folderPath: "/tmp/q9-code/scratchpad/atlas-coordinator",
            sessionLogPath: "/tmp/q9-code/scratchpad/atlas-coordinator/manager-session-log.md",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-thread-meta-update-manager-rename"),
          threadId: asThreadId("thread-manager"),
          title: "Beacon coordinator",
        },
        readModel: withManager,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event?.type).toBe("thread.meta-updated");
    expect(event?.payload.title).toBe("Beacon coordinator");
    expect(event?.payload.managerScratchpad).toEqual({
      folderPath: "/tmp/q9-code/scratchpad/beacon-coordinator-thread-manager",
      sessionLogPath:
        "/tmp/q9-code/scratchpad/beacon-coordinator-thread-manager/manager-session-log.md",
    });
    expect(event?.payload.previousManagerScratchpad).toEqual({
      folderPath: "/tmp/q9-code/scratchpad/atlas-coordinator",
      sessionLogPath: "/tmp/q9-code/scratchpad/atlas-coordinator/manager-session-log.md",
    });
  });

  it("allows managers to send explicit input to their own workers", async () => {
    const now = "2026-04-09T08:00:00.000Z";
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-created-worker-input"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-created-worker-input"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-created-worker-input"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Q9 Code",
          workspaceRoot: "/tmp/q9-code",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const withManager = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-created-manager-worker-input"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-manager"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-created-manager-worker-input"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-created-manager-worker-input"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-manager"),
          projectId: asProjectId("project-1"),
          title: "Atlas coordinator",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          role: "manager",
          managerScratchpad: {
            folderPath: "/tmp/q9-code/scratchpad/atlas-coordinator",
            sessionLogPath: "/tmp/q9-code/scratchpad/atlas-coordinator/manager-session-log.md",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withManager, {
        sequence: 3,
        eventId: asEventId("evt-thread-created-worker-worker-input"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-worker"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-created-worker-worker-input"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-created-worker-worker-input"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-worker"),
          projectId: asProjectId("project-1"),
          title: "Reconnect worker",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          role: "worker",
          managerThreadId: asThreadId("thread-manager"),
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "manager.worker.input.send",
          commandId: CommandId.makeUnsafe("cmd-manager-worker-input"),
          managerThreadId: asThreadId("thread-manager"),
          workerThreadId: asThreadId("thread-worker"),
          input: {
            messageId: "msg-manager-worker-input" as never,
            text: "Pause the current attempt and check the websocket reconnect path.",
            attachments: [],
          },
          mode: "interrupt",
          createdAt: now,
        },
        readModel,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event?.type).toBe("manager.worker-input-requested");
    expect(event?.payload).toMatchObject({
      managerThreadId: asThreadId("thread-manager"),
      workerThreadId: asThreadId("thread-worker"),
      mode: "interrupt",
      text: "Pause the current attempt and check the websocket reconnect path.",
    });
  });

  it("rejects manager input aimed at a thread outside the manager worker set", async () => {
    const now = "2026-04-09T08:00:00.000Z";
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-created-worker-input-invalid"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-created-worker-input-invalid"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-created-worker-input-invalid"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Q9 Code",
          workspaceRoot: "/tmp/q9-code",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const withManager = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-created-manager-worker-input-invalid"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-manager"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-created-manager-worker-input-invalid"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-created-manager-worker-input-invalid"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-manager"),
          projectId: asProjectId("project-1"),
          title: "Atlas coordinator",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          role: "manager",
          managerScratchpad: {
            folderPath: "/tmp/q9-code/scratchpad/atlas-coordinator",
            sessionLogPath: "/tmp/q9-code/scratchpad/atlas-coordinator/manager-session-log.md",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withManager, {
        sequence: 3,
        eventId: asEventId("evt-thread-created-other-worker-input-invalid"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-other"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-created-other-worker-input-invalid"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-created-other-worker-input-invalid"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-other"),
          projectId: asProjectId("project-1"),
          title: "Unrelated thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          role: "worker",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromiseExit(
      decideOrchestrationCommand({
        command: {
          type: "manager.worker.input.send",
          commandId: CommandId.makeUnsafe("cmd-manager-worker-input-invalid"),
          managerThreadId: asThreadId("thread-manager"),
          workerThreadId: asThreadId("thread-other"),
          input: {
            messageId: "msg-manager-worker-input-invalid" as never,
            text: "This should fail.",
            attachments: [],
          },
          mode: "queue",
          createdAt: now,
        },
        readModel,
      }),
    );

    expect(Exit.isFailure(result)).toBe(true);
  });
});
