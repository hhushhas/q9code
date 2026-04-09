import type { OrchestrationReadModel, OrchestrationThread, ThreadId } from "@t3tools/contracts";
import {
  extractManagerInternalAlert,
  MANAGER_DELEGATION_CLOSE_TAG,
  MANAGER_DELEGATION_OPEN_TAG,
  WORKER_FINAL_CLOSE_TAG,
  WORKER_FINAL_OPEN_TAG,
} from "@t3tools/shared/manager";

function findThread(
  readModel: OrchestrationReadModel,
  threadId: ThreadId | null | undefined,
): OrchestrationThread | null {
  if (!threadId) {
    return null;
  }
  return readModel.threads.find((thread) => thread.id === threadId) ?? null;
}

function resolveProjectTitle(readModel: OrchestrationReadModel, projectId: string): string {
  return readModel.projects.find((project) => project.id === projectId)?.title ?? "Project";
}

function buildKnownWorkerSummary(
  readModel: OrchestrationReadModel,
  managerThreadId: ThreadId,
): string {
  const workers = readModel.threads.filter(
    (thread) => thread.deletedAt === null && thread.managerThreadId === managerThreadId,
  );
  if (workers.length === 0) {
    return "No active workers yet.";
  }

  return workers
    .slice(0, 12)
    .map((worker) => {
      const status = worker.session?.status ?? "idle";
      return `- ${worker.title} (${worker.id}) status=${status}`;
    })
    .join("\n");
}

export function buildManagerTurnInput(input: {
  readModel: OrchestrationReadModel;
  thread: OrchestrationThread;
  userMessageText: string;
}): string {
  const projectTitle = resolveProjectTitle(input.readModel, input.thread.projectId);
  const scratchpad = input.thread.managerScratchpad;
  const knownWorkers = buildKnownWorkerSummary(input.readModel, input.thread.id);
  const internalAlert = extractManagerInternalAlert(input.userMessageText);
  const requestSection = internalAlert
    ? [
        "Internal worker alert:",
        ...internalAlert.alerts.map((alert) => {
          const details = alert.details ? ` · ${alert.details}` : "";
          return `- ${alert.workerTitle}: ${alert.summary}${details}`;
        }),
      ].join("\n")
    : `User request:\n${input.userMessageText}`;

  return [
    `You are the project manager for "${projectTitle}".`,
    "Coordinate the work. Do not directly perform implementation-heavy execution yourself unless the user explicitly overrides this workflow.",
    "Your default job is to clarify, plan, and delegate bounded worker threads.",
    "Follow project-level AGENTS.md guidance when it helps, but your manager role rules here stay authoritative if there is any tension.",
    scratchpad
      ? `Sacred manager folder: ${scratchpad.folderPath}\nSacred session log: ${scratchpad.sessionLogPath}`
      : "No sacred manager log path is available yet. Inform the user something went wrong.",
    "Before delegating, use the sacred session log when continuity or history matters.",
    internalAlert
      ? "This input is a system-level worker update, not a fresh human request. Reconcile worker progress, decide next steps, and only ask the human for help if there is a real blocker or decision."
      : "If the human asks for execution, delegate bounded workers instead of doing the implementation yourself.",
    "When the request needs execution, end your reply with exactly one delegation block using this format:",
    MANAGER_DELEGATION_OPEN_TAG,
    '{"summary":"short coordination note","workers":[{"title":"Short worker title","prompt":"Full worker assignment"}]}',
    MANAGER_DELEGATION_CLOSE_TAG,
    "If no worker should be launched, do not include the delegation block.",
    "Only request multiple workers when the tasks are clearly parallel and non-overlapping.",
    "Keep the human-visible part of your reply concise and managerial.",
    `Current workers:\n${knownWorkers}`,
    requestSection,
  ].join("\n\n");
}

export function buildWorkerTurnInput(input: {
  readModel: OrchestrationReadModel;
  thread: OrchestrationThread;
  userMessageText: string;
}): string {
  const projectTitle = resolveProjectTitle(input.readModel, input.thread.projectId);
  const managerThread = findThread(input.readModel, input.thread.managerThreadId);
  const managerScratchpad = managerThread?.managerScratchpad ?? null;

  return [
    `You are a worker thread for "${projectTitle}".`,
    managerThread
      ? `You are delegated by manager "${managerThread.title}" (${managerThread.id}).`
      : "",
    "Stay tightly scoped to the assigned task. Execute the work and report concrete outcomes.",
    "Do not spawn additional Q9 workers yourself. Do not re-plan the whole project unless the task explicitly asks for that.",
    "You may use codex-app internal subagents for exploration, investigation, or support work when that helps, but do not expand the Q9 manager-worker hierarchy.",
    "Follow helpful project guidance from AGENTS.md, but your worker-role constraints here remain authoritative if there is any conflict.",
    managerScratchpad
      ? `Manager folder: ${managerScratchpad.folderPath}\nManager session log: ${managerScratchpad.sessionLogPath}`
      : "",
    "The app records lifecycle updates in the manager log automatically. You may also read it if context is needed.",
    "Normal progress updates stay on the worker thread and should not be treated as completion.",
    "When you are ready to deliver the final manager-facing handoff, wrap that final response in exactly one worker-final block so the manager is notified:",
    WORKER_FINAL_OPEN_TAG,
    "Final outcome, verification, blockers, and any concrete next step.",
    WORKER_FINAL_CLOSE_TAG,
    "Do not use the worker-final block for intermediary updates.",
    `Assigned task:\n${input.userMessageText}`,
  ]
    .filter((section) => section.trim().length > 0)
    .join("\n\n");
}

export function buildThreadTurnInput(input: {
  readModel: OrchestrationReadModel;
  thread: OrchestrationThread;
  userMessageText: string;
}): string {
  if (input.thread.role === "manager") {
    return buildManagerTurnInput(input);
  }

  if (input.thread.managerThreadId !== null) {
    return buildWorkerTurnInput(input);
  }

  return input.userMessageText;
}
