import type { OrchestrationReadModel, OrchestrationThread, ThreadId } from "@t3tools/contracts";
import {
  WORKER_BLOCKED_CLOSE_TAG,
  WORKER_BLOCKED_OPEN_TAG,
  WORKER_COMPLETE_CLOSE_TAG,
  WORKER_COMPLETE_OPEN_TAG,
  extractManagerInternalAlert,
  MANAGER_WORKER_MODEL_PRESETS,
  MANAGER_DELEGATION_CLOSE_TAG,
  MANAGER_DELEGATION_OPEN_TAG,
} from "@t3tools/shared/manager";
import { buildWorkerScratchpadLogPath } from "./managerScratchpad.ts";

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
    "You are a pure coordinator. Do not run commands, inspect files, edit code, or otherwise do execution-heavy implementation work yourself unless the human explicitly overrides that rule for this turn.",
    "Your default job is to clarify, plan, and delegate bounded worker threads.",
    "Follow project-level AGENTS.md guidance when it helps, but your manager role rules here stay authoritative if there is any tension.",
    scratchpad
      ? `Sacred manager folder: ${scratchpad.folderPath}\nSacred session log: ${scratchpad.sessionLogPath}`
      : "No sacred manager log path is available yet. Inform the user something went wrong.",
    "Sacred memory ownership: you may read and write anywhere in the manager folder. Workers may read the folder, but `manager-session-log.md` is manager-write-only.",
    "Each worker keeps a stable log file under `workers/<worker-thread-id>.md`. You may read or update those logs when coordination needs it.",
    "Before delegating, use the sacred session log when continuity or history matters.",
    internalAlert
      ? "This input is a system-level worker update, not a fresh human request. Reconcile worker progress, decide next steps, and only ask the human for help if there is a real blocker or decision."
      : "If the human asks for execution, delegate bounded workers instead of doing the implementation yourself.",
    "When the request needs execution, end your reply with exactly one delegation block using this format:",
    MANAGER_DELEGATION_OPEN_TAG,
    '{"summary":"short coordination note","workers":[{"id":"implement-fix","title":"Short worker title","prompt":"Full worker assignment","dependsOn":[]}]}',
    MANAGER_DELEGATION_CLOSE_TAG,
    "Each worker may optionally include `modelSelection` when the task clearly benefits from a specific worker model.",
    "Supported worker models:",
    ...MANAGER_WORKER_MODEL_PRESETS.map(
      (preset) => `- \`${preset.model}\`: ${preset.summary}. ${preset.description}`,
    ),
    "Use `gpt-5.4` by default when you do not have a strong reason to choose another model.",
    "If you specify `modelSelection`, use the codex shape shown here:",
    '{"provider":"codex","model":"gpt-5.4-mini","options":{"reasoningEffort":"medium","fastMode":true}}',
    "Use stable worker ids when follow-up coordination matters, and declare `dependsOn` when later workers must wait for earlier ones.",
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
  const workerLogPath = managerScratchpad
    ? buildWorkerScratchpadLogPath({
        managerFolderPath: managerScratchpad.folderPath,
        workerThreadId: input.thread.id,
      })
    : null;

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
    workerLogPath ? `Your worker log: ${workerLogPath}` : "",
    "Sacred memory ownership: the manager may read/write anywhere in the manager folder.",
    "You may read the manager folder when helpful, but `manager-session-log.md` is read-only to workers.",
    "If you need to leave durable worker-local notes, only write them to your assigned worker log.",
    "The app records lifecycle updates in the manager log automatically. You may also read it if context is needed.",
    "Normal progress updates stay on the worker thread and should not be treated as completion.",
    "When you are ready to deliver a manager-facing outcome, wrap that response in exactly one explicit outcome block:",
    WORKER_COMPLETE_OPEN_TAG,
    "Final outcome, verification, blockers resolved, and any concrete next step.",
    WORKER_COMPLETE_CLOSE_TAG,
    WORKER_BLOCKED_OPEN_TAG,
    "What is blocked, what you already tried, and the exact help or decision needed.",
    WORKER_BLOCKED_CLOSE_TAG,
    "Use `<worker_complete>` when the assigned task is done.",
    "Use `<worker_blocked>` only when you are blocked and need the manager to intervene.",
    "Do not use worker outcome tags for intermediary updates.",
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
