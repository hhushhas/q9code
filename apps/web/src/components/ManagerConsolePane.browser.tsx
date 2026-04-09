import "../index.css";

import { ThreadId, type NativeApi } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ManagerConsolePane } from "./ManagerConsolePane";
import type { Project, Thread } from "../types";

const managerLogSpy = vi.fn<NativeApi["server"]["getManagerSessionLog"]>(() =>
  Promise.resolve({
    threadId: ThreadId.makeUnsafe("thread-manager"),
    sessionLogPath: "/repo/project/scratchpad/managers/atlas-coordinator/manager-session-log.md",
    contents: [
      "# Manager session log",
      "",
      "```manager-checklist",
      "- [x] Reconcile worker outcome semantics",
      "- [ ] Ship manager follow-up input controls",
      "```",
    ].join("\n"),
    readAt: "2026-04-09T08:00:00.000Z",
  }),
);
const dispatchCommandSpy = vi.fn<NativeApi["orchestration"]["dispatchCommand"]>(() =>
  Promise.resolve({ sequence: 42 }),
);

vi.mock("~/nativeApi", () => ({
  readNativeApi: () =>
    ({
      dialogs: {
        pickFolder: vi.fn(() => Promise.resolve(null)),
        confirm: vi.fn(() => Promise.resolve(true)),
      },
      terminal: {
        open: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        clear: vi.fn(),
        restart: vi.fn(),
        close: vi.fn(),
        onEvent: vi.fn(() => () => undefined),
      },
      projects: {
        searchEntries: vi.fn(),
        writeFile: vi.fn(),
      },
      provider: {
        listSkills: vi.fn(),
      },
      server: {
        getManagerSessionLog: managerLogSpy,
        getConfig: vi.fn(),
        refreshProviders: vi.fn(),
        upsertKeybinding: vi.fn(),
        getSettings: vi.fn(),
        updateSettings: vi.fn(),
      },
      orchestration: {
        dispatchCommand: dispatchCommandSpy,
        getSnapshot: vi.fn(),
        getTurnDiff: vi.fn(),
        getFullThreadDiff: vi.fn(),
        replayEvents: vi.fn(),
        onDomainEvent: vi.fn(() => () => undefined),
      },
      shell: {
        openInEditor: vi.fn(() => Promise.resolve()),
        openExternal: vi.fn(() => Promise.resolve()),
      },
      git: {
        listBranches: vi.fn(),
        createWorktree: vi.fn(),
        removeWorktree: vi.fn(),
        createBranch: vi.fn(),
        checkout: vi.fn(),
        init: vi.fn(),
        resolvePullRequest: vi.fn(),
        preparePullRequestThread: vi.fn(),
        pull: vi.fn(),
        status: vi.fn(),
      },
      contextMenu: {
        show: vi.fn(),
      },
    }) satisfies NativeApi,
}));

vi.mock("./ui/toast", () => ({
  toastManager: {
    add: vi.fn(),
  },
}));

const project: Project = {
  id: "project-1" as never,
  name: "Project",
  cwd: "/repo/project",
  defaultModelSelection: {
    provider: "codex",
    model: "gpt-5.4",
  },
  scripts: [],
};

const managerThread: Thread = {
  id: ThreadId.makeUnsafe("thread-manager"),
  codexThreadId: null,
  projectId: project.id,
  title: "Atlas coordinator",
  modelSelection: {
    provider: "codex",
    model: "gpt-5.4",
  },
  role: "manager",
  managerThreadId: null,
  managerScratchpad: {
    folderPath: "/repo/project/scratchpad/managers/atlas-coordinator",
    sessionLogPath: "/repo/project/scratchpad/managers/atlas-coordinator/manager-session-log.md",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  session: null,
  messages: [],
  proposedPlans: [],
  error: null,
  createdAt: "2026-04-09T08:00:00.000Z",
  archivedAt: null,
  updatedAt: "2026-04-09T08:00:00.000Z",
  latestTurn: null,
  branch: "main",
  worktreePath: "/repo/project",
  turnDiffSummaries: [],
  activities: [
    {
      id: "activity-worker-complete" as never,
      tone: "info",
      kind: "manager.worker.completed",
      summary: 'Worker "Reconnect worker" completed',
      payload: {
        workerThreadId: "thread-worker" as never,
        workerTitle: "Reconnect worker",
      },
      turnId: null,
      sequence: 1,
      createdAt: "2026-04-09T08:01:00.000Z",
    },
  ],
};

const workerThread: Thread = {
  id: ThreadId.makeUnsafe("thread-worker"),
  codexThreadId: null,
  projectId: project.id,
  title: "Reconnect worker",
  modelSelection: {
    provider: "codex",
    model: "gpt-5.4",
  },
  role: "worker",
  managerThreadId: managerThread.id,
  managerScratchpad: null,
  runtimeMode: "full-access",
  interactionMode: "default",
  session: {
    provider: "codex",
    status: "running",
    orchestrationStatus: "running",
    activeTurnId: "turn-worker" as never,
    createdAt: "2026-04-09T08:00:00.000Z",
    updatedAt: "2026-04-09T08:00:00.000Z",
  },
  messages: [],
  proposedPlans: [],
  error: null,
  createdAt: "2026-04-09T08:00:00.000Z",
  archivedAt: null,
  updatedAt: "2026-04-09T08:01:00.000Z",
  latestTurn: {
    turnId: "turn-worker" as never,
    state: "running",
    requestedAt: "2026-04-09T08:00:00.000Z",
    startedAt: "2026-04-09T08:00:00.000Z",
    completedAt: null,
    assistantMessageId: null,
    sourceProposedPlan: undefined,
  },
  branch: "main",
  worktreePath: "/repo/project",
  turnDiffSummaries: [],
  activities: [],
};

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("ManagerConsolePane", () => {
  it("renders the parsed checklist, supports worker model selection, and dispatches manager input", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ManagerConsolePane
        managerThread={managerThread}
        activeProject={project}
        projectThreads={[managerThread, workerThread]}
        onOpenThread={vi.fn()}
      />,
      { container: host },
    );

    try {
      await expect
        .element(page.getByText("Reconcile worker outcome semantics"))
        .toBeInTheDocument();
      await expect
        .element(page.getByText("Ship manager follow-up input controls"))
        .toBeInTheDocument();
      await expect.element(page.getByText("Outcome logged")).toBeInTheDocument();

      await page.getByRole("button", { name: /Delegate Worker/i }).click();
      await page.getByPlaceholder("e.g., auth-reconnect-fix").fill("Support search");
      await page.getByText("GPT-5.4 Mini").click();
      await page.getByRole("button", { name: /Low/ }).click();
      await page.getByRole("button", { name: /Fast mode/i }).click();
      await page
        .getByPlaceholder("Implement the fix, run verification, and reconcile outcome...")
        .fill("Search the codebase for websocket reconnect regressions and summarize the results.");
      const launchButtons = document.querySelectorAll('button[type="submit"]');
      (launchButtons.item(launchButtons.length - 1) as HTMLButtonElement | null)?.click();

      await vi.waitFor(() => {
        expect(dispatchCommandSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "thread.create",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4-mini",
              options: {
                reasoningEffort: "low",
                fastMode: true,
              },
            },
          }),
        );
        expect(dispatchCommandSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "thread.turn.start",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4-mini",
              options: {
                reasoningEffort: "low",
                fastMode: true,
              },
            },
          }),
        );
      });

      await page.getByRole("button", { name: "Input" }).click({ force: true });
      await page.getByRole("button", { name: "Interrupt" }).first().click({ force: true });
      await page
        .getByPlaceholder("Clarify the next step, unblock a decision, or redirect the worker...")
        .fill("Stop the current turn and retry with websocket tracing enabled.");
      const submitButtons = document.querySelectorAll('button[type="submit"]');
      (submitButtons.item(submitButtons.length - 1) as HTMLButtonElement | null)?.click();

      await vi.waitFor(() => {
        expect(dispatchCommandSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "manager.worker.input.send",
            managerThreadId: managerThread.id,
            workerThreadId: workerThread.id,
            mode: "interrupt",
            input: expect.objectContaining({
              text: "Stop the current turn and retry with websocket tracing enabled.",
              messageId: expect.any(String),
            }),
          }),
        );
      });
      expect(managerLogSpy).toHaveBeenCalledWith(managerThread.id);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
