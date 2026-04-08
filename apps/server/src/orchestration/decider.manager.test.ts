import { CommandId, EventId, ProjectId, ThreadId } from "@t3tools/contracts";
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
    expect(event.type).toBe("thread.created");
    expect("managerScratchpad" in event.payload && event.payload.managerScratchpad).toEqual({
      folderPath: "/tmp/q9-code/scratchpad/managers/q9-code",
      sessionLogPath: "/tmp/q9-code/scratchpad/managers/q9-code/manager-session-log.md",
    });
  });

  it("rejects creating a second manager thread for the same project", async () => {
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
            folderPath: "/tmp/q9-code/scratchpad/managers/q9-code",
            sessionLogPath: "/tmp/q9-code/scratchpad/managers/q9-code/manager-session-log.md",
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

    const result = await Effect.runPromiseExit(
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

    expect(Exit.isFailure(result)).toBe(true);
  });
});
