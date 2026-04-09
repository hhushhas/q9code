import { describe, expect, it } from "vitest";

import { buildWorkerTurnInput } from "./managerRuntime.ts";

describe("buildWorkerTurnInput", () => {
  it("instructs workers to reserve worker-final tags for the final manager handoff", () => {
    const result = buildWorkerTurnInput({
      readModel: {
        version: 1,
        projects: [
          {
            id: "project-1" as never,
            title: "Q9 Code",
            workspaceRoot: "/tmp/q9-code",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-04-09T00:00:00.000Z",
            updatedAt: "2026-04-09T00:00:00.000Z",
          },
        ],
        threads: [
          {
            id: "thread-manager" as never,
            projectId: "project-1" as never,
            title: "Project manager",
            role: "manager",
            managerThreadId: null,
            managerScratchpad: {
              folderPath: "/tmp/q9-code/scratchpad/managers/q9-code",
              sessionLogPath: "/tmp/q9-code/scratchpad/managers/q9-code/manager-session-log.md",
            },
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            interactionMode: "default",
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            messages: [],
            activities: [],
            latestTurn: null,
            session: null,
            createdAt: "2026-04-09T00:00:00.000Z",
            updatedAt: "2026-04-09T00:00:00.000Z",
            deletedAt: null,
          },
          {
            id: "thread-worker" as never,
            projectId: "project-1" as never,
            title: "Reconnect worker",
            role: "worker",
            managerThreadId: "thread-manager" as never,
            managerScratchpad: null,
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            interactionMode: "default",
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            messages: [],
            activities: [],
            latestTurn: null,
            session: null,
            createdAt: "2026-04-09T00:00:00.000Z",
            updatedAt: "2026-04-09T00:00:00.000Z",
            deletedAt: null,
          },
        ],
      } as never,
      thread: {
        id: "thread-worker" as never,
        projectId: "project-1" as never,
        title: "Reconnect worker",
        role: "worker",
        managerThreadId: "thread-manager" as never,
        managerScratchpad: null,
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        messages: [],
        activities: [],
        latestTurn: null,
        session: null,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z",
        deletedAt: null,
      } as never,
      userMessageText: "Implement the manager wake-up fix.",
    });

    expect(result).toContain("<worker_final>");
    expect(result).toContain("</worker_final>");
    expect(result).toContain("Normal progress updates stay on the worker thread");
    expect(result).toContain("Do not use the worker-final block for intermediary updates.");
  });
});
