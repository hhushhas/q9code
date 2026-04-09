import { DEFAULT_THREAD_ROLE, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "../types";
import { collectCompletedThreadCandidates } from "./taskCompletion.logic";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    role: DEFAULT_THREAD_ROLE,
    managerThreadId: null,
    managerScratchpad: null,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-09T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("collectCompletedThreadCandidates", () => {
  it("returns a candidate when a completed turn becomes settled after the session leaves running", () => {
    const turnId = TurnId.makeUnsafe("turn-1");
    const previous = makeThread({
      session: {
        provider: "codex",
        status: "running",
        orchestrationStatus: "running",
        activeTurnId: turnId,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:02.000Z",
      },
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-09T00:00:00.000Z",
        startedAt: "2026-04-09T00:00:00.000Z",
        completedAt: "2026-04-09T00:00:05.000Z",
        assistantMessageId: null,
      },
      messages: [
        {
          id: "assistant-1" as never,
          role: "assistant",
          text: "All done",
          createdAt: "2026-04-09T00:00:05.000Z",
          completedAt: "2026-04-09T00:00:05.000Z",
          streaming: false,
        },
      ],
    });

    const next = makeThread({
      ...previous,
      session: {
        ...previous.session!,
        status: "ready",
        orchestrationStatus: "ready",
        activeTurnId: undefined,
        updatedAt: "2026-04-09T00:00:06.000Z",
      },
    });

    expect(collectCompletedThreadCandidates([previous], [next])).toMatchObject([
      {
        threadId: next.id,
        title: "Thread",
        completedAt: "2026-04-09T00:00:05.000Z",
        assistantSummary: "All done",
      },
    ]);
  });

  it("returns a candidate when the same turn gains a completedAt timestamp before the session changes", () => {
    const turnId = TurnId.makeUnsafe("turn-1");
    const previous = makeThread({
      session: {
        provider: "codex",
        status: "running",
        orchestrationStatus: "running",
        activeTurnId: turnId,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:02.000Z",
      },
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: "2026-04-09T00:00:00.000Z",
        startedAt: "2026-04-09T00:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });

    const next = makeThread({
      ...previous,
      latestTurn: {
        ...previous.latestTurn!,
        state: "completed",
        completedAt: "2026-04-09T00:00:05.000Z",
      },
      messages: [
        {
          id: "assistant-1" as never,
          role: "assistant",
          text: "Done and dusted",
          createdAt: "2026-04-09T00:00:05.000Z",
          completedAt: "2026-04-09T00:00:05.000Z",
          streaming: false,
        },
      ],
    });

    expect(collectCompletedThreadCandidates([previous], [next])).toEqual([]);
  });

  it("does not duplicate a notification once the turn was already settled in the previous snapshot", () => {
    const thread = makeThread({
      session: {
        provider: "codex",
        status: "ready",
        orchestrationStatus: "ready",
        activeTurnId: undefined,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:06.000Z",
      },
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-1"),
        state: "completed",
        requestedAt: "2026-04-09T00:00:00.000Z",
        startedAt: "2026-04-09T00:00:00.000Z",
        completedAt: "2026-04-09T00:00:05.000Z",
        assistantMessageId: null,
      },
      messages: [
        {
          id: "assistant-1" as never,
          role: "assistant",
          text: "Already reported",
          createdAt: "2026-04-09T00:00:05.000Z",
          completedAt: "2026-04-09T00:00:05.000Z",
          streaming: false,
        },
      ],
    });

    expect(collectCompletedThreadCandidates([thread], [thread])).toEqual([]);
  });
});
