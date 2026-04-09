import { describe, expect, it } from "vitest";

import { buildManagerTurnInput, buildWorkerTurnInput } from "./managerRuntime.ts";

describe("buildManagerTurnInput", () => {
  it("teaches managers the approved worker model presets and delegation shape", () => {
    const result = buildManagerTurnInput({
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
              folderPath: "/tmp/q9-code/scratchpad/atlas-coordinator",
              sessionLogPath: "/tmp/q9-code/scratchpad/atlas-coordinator/manager-session-log.md",
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
        ],
      } as never,
      thread: {
        id: "thread-manager" as never,
        projectId: "project-1" as never,
        title: "Project manager",
        role: "manager",
        managerThreadId: null,
        managerScratchpad: {
          folderPath: "/tmp/q9-code/scratchpad/atlas-coordinator",
          sessionLogPath: "/tmp/q9-code/scratchpad/atlas-coordinator/manager-session-log.md",
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
      } as never,
      userMessageText: "Coordinate the release.",
    });

    expect(result).toContain("`gpt-5.4`: General smartest.");
    expect(result).toContain("`gpt-5.3-codex`: Code-smart specialist.");
    expect(result).toContain("`gpt-5.4-mini`: Fast high-volume support.");
    expect(result).toContain('"model":"gpt-5.4-mini"');
    expect(result).toContain("Use `gpt-5.4` by default");
  });
});

describe("buildWorkerTurnInput", () => {
  it("instructs workers to use explicit outcome tags and worker-log ownership", () => {
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
              folderPath: "/tmp/q9-code/scratchpad/atlas-coordinator",
              sessionLogPath: "/tmp/q9-code/scratchpad/atlas-coordinator/manager-session-log.md",
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

    expect(result).toContain("<worker_complete>");
    expect(result).toContain("</worker_complete>");
    expect(result).toContain("<worker_blocked>");
    expect(result).toContain("</worker_blocked>");
    expect(result).toContain("/tmp/q9-code/scratchpad/atlas-coordinator/workers/thread-worker.md");
    expect(result).toContain("Normal progress updates stay on the worker thread");
    expect(result).toContain("manager-session-log.md` is read-only to workers");
    expect(result).toContain("Do not use worker outcome tags for intermediary updates.");
  });
});
