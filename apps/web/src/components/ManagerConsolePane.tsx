import {
  ThreadId,
  type CodexModelOptions,
  type ManagerDelegationWorkerModel,
  type ManagerWorkerInputMode,
} from "@t3tools/contracts";
import {
  extractManagerChecklist,
  MANAGER_WORKER_MODEL_CAPABILITIES,
  MANAGER_WORKER_MODEL_PRESETS,
  MANAGER_WORKER_MODEL_SELECTION,
} from "@t3tools/shared/manager";
import {
  getDefaultEffort,
  normalizeCodexModelOptionsWithCapabilities,
} from "@t3tools/shared/model";
import {
  FileTextIcon,
  FolderOpenIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { type Project, type Thread } from "../types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldDescription, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { toastManager } from "./ui/toast";

function statusLabelForThread(thread: Thread): string {
  if (thread.activities.some((activity) => activity.kind === "approval.requested")) {
    return "Needs approval";
  }
  if (thread.activities.some((activity) => activity.kind === "user-input.requested")) {
    return "Needs input";
  }
  if (thread.session?.status === "running") {
    return "Running";
  }
  if (thread.session?.status === "error") {
    return "Error";
  }
  if (thread.session?.status === "connecting") {
    return "Starting";
  }
  if (thread.latestTurn && thread.latestTurn.completedAt === null) {
    return "Working";
  }
  if (thread.latestTurn?.completedAt) {
    return "Completed";
  }
  return "Idle";
}

function sortWorkers(left: Thread, right: Thread): number {
  const leftUpdatedAt = left.updatedAt ?? left.createdAt;
  const rightUpdatedAt = right.updatedAt ?? right.createdAt;
  return rightUpdatedAt.localeCompare(leftUpdatedAt) || left.title.localeCompare(right.title);
}

function workerSupportsInterrupt(thread: Thread): boolean {
  return (
    thread.session?.orchestrationStatus === "running" ||
    (thread.latestTurn !== null && thread.latestTurn.completedAt === null)
  );
}

function normalizeManagerWorkerOutcome(
  managerThread: Thread,
  workerThreadId: ThreadId,
): {
  tone: "success" | "warning" | "error" | "neutral";
  label: string;
} | null {
  const matchingActivities = managerThread.activities
    .filter((activity) => {
      if (
        activity.kind !== "manager.worker.completed" &&
        activity.kind !== "manager.worker.blocked" &&
        activity.kind !== "manager.worker.failed"
      ) {
        return false;
      }
      const payload =
        activity.payload && typeof activity.payload === "object"
          ? (activity.payload as Record<string, unknown>)
          : null;
      return payload?.workerThreadId === workerThreadId;
    })
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const latest = matchingActivities[0];
  if (!latest) {
    return null;
  }
  if (latest.kind === "manager.worker.completed") {
    return { tone: "success", label: "Outcome logged" };
  }
  if (latest.kind === "manager.worker.failed") {
    return { tone: "error", label: "Needs recovery" };
  }
  return { tone: "warning", label: "Blocked" };
}

export function ManagerConsolePane({
  managerThread,
  activeProject,
  projectThreads,
  onOpenThread,
}: {
  managerThread: Thread;
  activeProject: Project;
  projectThreads: readonly Thread[];
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const [delegateDialogOpen, setDelegateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [workerTitle, setWorkerTitle] = useState("");
  const [workerPrompt, setWorkerPrompt] = useState("");
  const [workerModel, setWorkerModel] = useState<ManagerDelegationWorkerModel>(
    MANAGER_WORKER_MODEL_SELECTION.model as ManagerDelegationWorkerModel,
  );
  const [workerReasoningEffort, setWorkerReasoningEffort] = useState<
    CodexModelOptions["reasoningEffort"] | ""
  >(
    (getDefaultEffort(MANAGER_WORKER_MODEL_CAPABILITIES) as CodexModelOptions["reasoningEffort"]) ??
      "",
  );
  const [workerFastMode, setWorkerFastMode] = useState(false);
  const [managerTitleDraft, setManagerTitleDraft] = useState(managerThread.title);
  const [isLaunchingWorker, setIsLaunchingWorker] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [sendInputDialogOpen, setSendInputDialogOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<ThreadId | null>(null);
  const [workerInputDraft, setWorkerInputDraft] = useState("");
  const [workerInputMode, setWorkerInputMode] = useState<ManagerWorkerInputMode>("queue");
  const [isSendingWorkerInput, setIsSendingWorkerInput] = useState(false);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [checklistReadAt, setChecklistReadAt] = useState<string | null>(null);
  const [managerChecklist, setManagerChecklist] = useState<ReturnType<
    typeof extractManagerChecklist
  > | null>(null);

  const workerThreads = useMemo(
    () =>
      projectThreads
        .filter(
          (thread) => thread.managerThreadId === managerThread.id && thread.archivedAt === null,
        )
        .toSorted(sortWorkers),
    [managerThread.id, projectThreads],
  );

  const workerStats = useMemo(() => {
    const blocked = workerThreads.filter(
      (thread) =>
        thread.activities.some((activity) => activity.kind === "approval.requested") ||
        thread.activities.some((activity) => activity.kind === "user-input.requested"),
    ).length;
    const running = workerThreads.filter(
      (thread) =>
        thread.session?.status === "running" ||
        (thread.latestTurn !== null && thread.latestTurn.completedAt === null),
    ).length;
    const completed = workerThreads.filter(
      (thread) =>
        thread.latestTurn?.completedAt !== null &&
        thread.session?.status !== "running" &&
        !thread.activities.some((activity) => activity.kind === "approval.requested") &&
        !thread.activities.some((activity) => activity.kind === "user-input.requested"),
    ).length;

    return {
      total: workerThreads.length,
      blocked,
      running,
      completed,
    };
  }, [workerThreads]);

  const selectedWorker = useMemo(
    () => workerThreads.find((thread) => thread.id === selectedWorkerId) ?? null,
    [selectedWorkerId, workerThreads],
  );
  const workerLaunchModelSelection = useMemo(() => {
    const normalizedOptions = normalizeCodexModelOptionsWithCapabilities(
      MANAGER_WORKER_MODEL_CAPABILITIES,
      {
        ...(workerReasoningEffort ? { reasoningEffort: workerReasoningEffort } : {}),
        fastMode: workerFastMode,
      },
    );

    return {
      provider: "codex" as const,
      model: workerModel,
      ...(normalizedOptions ? { options: normalizedOptions } : {}),
    };
  }, [workerFastMode, workerModel, workerReasoningEffort]);

  const resetWorkerLaunchDraft = useCallback(() => {
    setWorkerTitle("");
    setWorkerPrompt("");
    setWorkerModel(MANAGER_WORKER_MODEL_SELECTION.model as ManagerDelegationWorkerModel);
    setWorkerReasoningEffort(
      (getDefaultEffort(
        MANAGER_WORKER_MODEL_CAPABILITIES,
      ) as CodexModelOptions["reasoningEffort"]) ?? "",
    );
    setWorkerFastMode(false);
  }, []);

  const openPath = useCallback(async (targetPath: string | null | undefined, label: string) => {
    const api = readNativeApi();
    if (!api || !targetPath) {
      return;
    }
    try {
      await api.shell.openInEditor(targetPath, "file-manager");
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Unable to open ${label.toLowerCase()}`,
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  }, []);

  const loadManagerChecklist = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      return;
    }

    setChecklistLoading(true);
    setChecklistError(null);
    try {
      const result = await api.server.getManagerSessionLog(managerThread.id);
      setManagerChecklist(extractManagerChecklist(result.contents));
      setChecklistReadAt(result.readAt);
    } catch (error) {
      setChecklistError(
        error instanceof Error ? error.message : "Unable to load manager session log.",
      );
    } finally {
      setChecklistLoading(false);
    }
  }, [managerThread.id]);

  useEffect(() => {
    void loadManagerChecklist();
  }, [loadManagerChecklist]);

  const launchDelegatedWorker = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isLaunchingWorker) {
        return;
      }

      const title = workerTitle.trim();
      const prompt = workerPrompt.trim();
      if (title.length === 0 || prompt.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Worker details are incomplete",
          description: "Add both a worker title and a concrete assignment.",
        });
        return;
      }

      const api = readNativeApi();
      if (!api) {
        return;
      }

      const workerThreadId = newThreadId();
      const createdAt = new Date().toISOString();
      setIsLaunchingWorker(true);
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId: workerThreadId,
          projectId: activeProject.id,
          title,
          modelSelection: workerLaunchModelSelection,
          role: "worker",
          managerThreadId: managerThread.id,
          runtimeMode: managerThread.runtimeMode,
          interactionMode: "default",
          branch: managerThread.branch,
          worktreePath: managerThread.worktreePath,
          createdAt,
        });
        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: workerThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: prompt,
            attachments: [],
          },
          modelSelection: workerLaunchModelSelection,
          titleSeed: title,
          runtimeMode: managerThread.runtimeMode,
          interactionMode: "default",
          createdAt,
        });
        toastManager.add({
          type: "success",
          title: "Worker launched",
          description: `${title} is now running under ${managerThread.title}.`,
        });
        resetWorkerLaunchDraft();
        setDelegateDialogOpen(false);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Worker launch failed",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      } finally {
        setIsLaunchingWorker(false);
      }
    },
    [
      activeProject.id,
      isLaunchingWorker,
      managerThread,
      resetWorkerLaunchDraft,
      workerLaunchModelSelection,
      workerPrompt,
      workerTitle,
    ],
  );

  const openWorkerInputDialog = useCallback((thread: Thread) => {
    setSelectedWorkerId(thread.id);
    setWorkerInputDraft("");
    setWorkerInputMode(workerSupportsInterrupt(thread) ? "interrupt" : "queue");
    setSendInputDialogOpen(true);
  }, []);

  const sendInputToWorker = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSendingWorkerInput || !selectedWorker) {
        return;
      }

      const trimmedInput = workerInputDraft.trim();
      if (trimmedInput.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Worker input is empty",
          description: "Add a concrete follow-up message before sending it.",
        });
        return;
      }

      const interruptAllowed = workerSupportsInterrupt(selectedWorker);
      const effectiveMode: ManagerWorkerInputMode =
        workerInputMode === "interrupt" && interruptAllowed ? "interrupt" : "queue";
      const api = readNativeApi();
      if (!api) {
        return;
      }

      setIsSendingWorkerInput(true);
      try {
        await api.orchestration.dispatchCommand({
          type: "manager.worker.input.send",
          commandId: newCommandId(),
          managerThreadId: managerThread.id,
          workerThreadId: selectedWorker.id,
          input: {
            messageId: newMessageId(),
            text: trimmedInput,
            attachments: [],
          },
          mode: effectiveMode,
          createdAt: new Date().toISOString(),
        });
        toastManager.add({
          type: "success",
          title: "Worker updated",
          description:
            effectiveMode === "interrupt"
              ? `Interrupted ${selectedWorker.title} and sent the new instruction.`
              : `Queued the new instruction for ${selectedWorker.title}.`,
        });
        setWorkerInputDraft("");
        setSendInputDialogOpen(false);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Worker update failed",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      } finally {
        setIsSendingWorkerInput(false);
      }
    },
    [isSendingWorkerInput, managerThread.id, selectedWorker, workerInputDraft, workerInputMode],
  );

  const saveManagerTitle = useCallback(async () => {
    const trimmed = managerTitleDraft.trim();
    if (trimmed.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Manager title cannot be empty",
      });
      return;
    }
    if (trimmed === managerThread.title) {
      setRenameDialogOpen(false);
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    setIsSavingTitle(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: managerThread.id,
        title: trimmed,
      });
      setRenameDialogOpen(false);
      toastManager.add({
        type: "success",
        title: "Manager renamed",
        description: `Now coordinating as ${trimmed}.`,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Rename failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    } finally {
      setIsSavingTitle(false);
    }
  }, [managerThread.id, managerThread.title, managerTitleDraft]);

  return (
    <div className="flex h-full flex-col font-mono">
      <div className="flex-1 space-y-6 overflow-y-auto px-1 py-1 pr-3">
        {/* Swarm Snapshot */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground/60">Swarm</h3>
            <span className="text-[10px] text-muted-foreground/50">
              {workerStats.total} workers
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border border-border/60 bg-card p-2">
              <div className="text-[10px] text-muted-foreground/70">Active</div>
              <div className="text-lg font-semibold text-foreground leading-tight">
                {workerStats.running}
              </div>
            </div>
            <div
              className={`rounded-lg border p-2 ${
                workerStats.blocked > 0
                  ? "border-warning/40 bg-warning/10"
                  : "border-border/60 bg-card"
              }`}
            >
              <div
                className={`text-[10px] ${
                  workerStats.blocked > 0
                    ? "text-warning-foreground/80"
                    : "text-muted-foreground/70"
                }`}
              >
                Blocked
              </div>
              <div
                className={`text-lg font-semibold leading-tight ${
                  workerStats.blocked > 0 ? "text-warning-foreground" : "text-foreground"
                }`}
              >
                {workerStats.blocked}
              </div>
            </div>
          </div>
        </section>

        {/* Sacred Memory */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground/60">Memory</h3>
          <div className="space-y-1">
            <button
              type="button"
              disabled={!managerThread.managerScratchpad?.sessionLogPath}
              onClick={() =>
                openPath(managerThread.managerScratchpad?.sessionLogPath, "Manager log")
              }
              className="group flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
            >
              <FileTextIcon className="size-3.5 text-muted-foreground/60" />
              <div className="min-w-0 flex-1 truncate text-xs text-foreground">session-log.md</div>
            </button>
            <button
              type="button"
              disabled={!managerThread.managerScratchpad?.folderPath}
              onClick={() =>
                openPath(managerThread.managerScratchpad?.folderPath, "Manager folder")
              }
              className="group flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
            >
              <FolderOpenIcon className="size-3.5 text-muted-foreground/60" />
              <div className="min-w-0 flex-1 truncate text-xs text-foreground">scratchpad/</div>
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground/60">Checklist</h3>
            <button
              type="button"
              onClick={() => void loadManagerChecklist()}
              disabled={checklistLoading}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <RefreshCwIcon className={`size-3 ${checklistLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="space-y-1.5">
            {checklistError ? (
              <div className="text-xs text-destructive">{checklistError}</div>
            ) : managerChecklist ? (
              <>
                {managerChecklist.items.map((item) => (
                  <div
                    key={`${item.text}-${item.checked ? "done" : "todo"}`}
                    className="flex gap-2 items-start"
                  >
                    <span
                      className={`mt-0.5 inline-flex size-3.5 items-center justify-center rounded border text-[9px] ${
                        item.checked
                          ? "border-success/40 bg-success/15 text-success-foreground"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {item.checked ? "✓" : ""}
                    </span>
                    <span
                      className={`text-xs leading-relaxed ${
                        item.checked
                          ? "text-muted-foreground/60 line-through"
                          : "text-foreground/90"
                      }`}
                    >
                      {item.text}
                    </span>
                  </div>
                ))}
                <div className="pt-1 text-[10px] text-muted-foreground/40">
                  {checklistReadAt
                    ? `Updated ${new Date(checklistReadAt).toLocaleTimeString()}`
                    : ""}
                </div>
              </>
            ) : (
              <div className="space-y-1 text-[11px] text-muted-foreground/60">
                <div>No checklist block found in session log.</div>
              </div>
            )}
          </div>
        </section>

        {/* Workers */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground/60">Workers</h3>
            <button
              type="button"
              onClick={() => setDelegateDialogOpen(true)}
              className="inline-flex items-center text-muted-foreground/50 hover:text-foreground transition-colors"
              title="Add worker"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>
          <div className="space-y-1">
            {workerThreads.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted px-2 py-2 text-center text-[11px] text-muted-foreground">
                No active workers
              </div>
            ) : (
              workerThreads.map((thread) => {
                const isBlocked =
                  thread.activities.some((activity) => activity.kind === "approval.requested") ||
                  thread.activities.some((activity) => activity.kind === "user-input.requested");
                const isRunning =
                  thread.session?.status === "running" ||
                  (thread.latestTurn !== null && thread.latestTurn.completedAt === null);
                const outcome = normalizeManagerWorkerOutcome(managerThread, thread.id);

                return (
                  <div
                    key={thread.id}
                    className={`flex w-full items-center justify-between rounded-lg border py-1.5 px-2 transition-colors hover:bg-accent/30 ${
                      isBlocked ? "border-warning/40 bg-warning/10" : "border-border/60 bg-card"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenThread(thread.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className={`status-dot ${
                            isBlocked
                              ? "status-dot-blocked"
                              : isRunning
                                ? "status-dot-active animate-pulse"
                                : "status-dot-idle"
                          }`}
                        />
                        <span
                          className={`truncate text-xs font-medium ${
                            isBlocked ? "text-destructive" : "text-foreground"
                          }`}
                        >
                          {thread.title}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className={`text-[10px] ${
                            isBlocked ? "font-medium text-destructive" : "text-muted-foreground/70"
                          }`}
                        >
                          {statusLabelForThread(thread)}
                        </span>
                        {outcome ? (
                          <span
                            className={`text-[9px] ${
                              outcome.tone === "success"
                                ? "text-success-foreground"
                                : outcome.tone === "warning"
                                  ? "text-warning-foreground"
                                  : outcome.tone === "error"
                                    ? "text-destructive"
                                    : "text-muted-foreground"
                            }`}
                          >
                            {outcome.label}
                          </span>
                        ) : null}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="ml-2 shrink-0 inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
                      onClick={() => openWorkerInputDialog(thread)}
                    >
                      <MessageSquareIcon className="size-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <Dialog open={delegateDialogOpen} onOpenChange={setDelegateDialogOpen}>
        <DialogPopup className="max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg border border-border/60 bg-secondary text-foreground">
                <PlusIcon className="size-4" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg font-medium">
                  Delegate Worker
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground/70">
                  Launch bounded execution
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={launchDelegatedWorker} className="flex flex-col flex-1 min-h-0">
            <DialogPanel className="flex-1 overflow-y-auto py-4 space-y-4">
              <Field className="space-y-1.5">
                <FieldLabel className="text-xs text-muted-foreground">Worker identity</FieldLabel>
                <Input
                  value={workerTitle}
                  onChange={(event) => setWorkerTitle(event.target.value)}
                  placeholder="e.g., auth-reconnect-fix"
                  className="border-border/40 bg-card/50 text-sm h-9"
                />
                <FieldDescription className="text-[11px] text-muted-foreground/50">
                  Short slug for the swarm list
                </FieldDescription>
              </Field>
              <Field className="space-y-2">
                <FieldLabel className="text-xs text-muted-foreground">Worker model</FieldLabel>
                <div className="grid grid-cols-3 gap-1.5">
                  {MANAGER_WORKER_MODEL_PRESETS.map((preset) => (
                    <button
                      key={preset.model}
                      type="button"
                      onClick={() => setWorkerModel(preset.model)}
                      className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                        workerModel === preset.model
                          ? "border-border bg-accent text-accent-foreground"
                          : "border-border/60 bg-card text-foreground hover:bg-accent/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="text-xs font-medium truncate">{preset.label}</div>
                        {preset.isDefault ? (
                          <span className="text-[9px] text-muted-foreground shrink-0">def</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                        {preset.summary}
                      </div>
                    </button>
                  ))}
                </div>
              </Field>
              <Field className="space-y-2">
                <FieldLabel className="text-xs text-muted-foreground">Reasoning</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {MANAGER_WORKER_MODEL_CAPABILITIES.reasoningEffortLevels.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setWorkerReasoningEffort(
                          option.value as CodexModelOptions["reasoningEffort"],
                        )
                      }
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        workerReasoningEffort === option.value
                          ? "border-border bg-accent text-accent-foreground"
                          : "border-border/60 bg-card text-muted-foreground hover:bg-accent/30"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field className="space-y-2">
                <FieldLabel className="text-xs text-muted-foreground">Speed</FieldLabel>
                <button
                  type="button"
                  onClick={() => setWorkerFastMode((current) => !current)}
                  className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    workerFastMode
                      ? "border-border bg-accent text-accent-foreground"
                      : "border-border/60 bg-card text-foreground hover:bg-accent/40"
                  }`}
                >
                  <div className="text-sm font-medium">Fast mode</div>
                  <span
                    className={`text-xs ${workerFastMode ? "text-success-foreground" : "text-muted-foreground"}`}
                  >
                    {workerFastMode ? "On" : "Off"}
                  </span>
                </button>
              </Field>
              <Field className="space-y-1.5">
                <FieldLabel className="text-xs text-muted-foreground">
                  Mission assignment
                </FieldLabel>
                <Textarea
                  value={workerPrompt}
                  onChange={(event) => setWorkerPrompt(event.target.value)}
                  placeholder="Implement the fix, run verification, and reconcile outcome..."
                  className="min-h-[100px] border-border/40 bg-card/50 text-sm leading-relaxed"
                />
              </Field>
            </DialogPanel>
            <DialogFooter className="shrink-0 pt-4 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                className="text-xs"
                onClick={() => {
                  resetWorkerLaunchDraft();
                  setDelegateDialogOpen(false);
                }}
                disabled={isLaunchingWorker}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLaunchingWorker} className="px-4 text-xs">
                {isLaunchingWorker ? "Launching..." : "Launch"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg border border-border/60 bg-secondary text-foreground">
                <PencilIcon className="size-4" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg font-medium">
                  Identify Coordinator
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground/70">
                  Rename manager entity
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogPanel className="py-6">
            <Field className="space-y-2">
              <FieldLabel className="text-xs text-muted-foreground">Durable Name</FieldLabel>
              <Input
                value={managerTitleDraft}
                onChange={(event) => setManagerTitleDraft(event.target.value)}
                placeholder="e.g., Frontend Lead"
                className="border-border/40 bg-card/50 text-sm focus:border-primary/40"
              />
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="text-xs"
              onClick={() => setRenameDialogOpen(false)}
              disabled={isSavingTitle}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveManagerTitle()}
              disabled={isSavingTitle}
              className="px-6 text-xs"
            >
              {isSavingTitle ? "Updating..." : "Commit Name"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={sendInputDialogOpen} onOpenChange={setSendInputDialogOpen}>
        <DialogPopup className="max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg border border-border/60 bg-secondary text-foreground">
                <MessageSquareIcon className="size-4" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg font-medium">Send input</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground/70">
                  {selectedWorker ? selectedWorker.title : "Choose delivery mode"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={sendInputToWorker} className="flex flex-col flex-1 min-h-0">
            <DialogPanel className="flex-1 overflow-y-auto py-4 space-y-4">
              <Field className="space-y-2">
                <FieldLabel className="text-xs text-muted-foreground">Delivery mode</FieldLabel>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setWorkerInputMode("interrupt")}
                    disabled={!selectedWorker || !workerSupportsInterrupt(selectedWorker)}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      workerInputMode === "interrupt"
                        ? "border-border bg-accent text-accent-foreground"
                        : "border-border/60 bg-card text-muted-foreground"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <div className="text-sm font-medium">Interrupt</div>
                    <div className="text-[10px] text-muted-foreground/80">
                      Stop current turn first
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkerInputMode("queue")}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      workerInputMode === "queue"
                        ? "border-border bg-accent text-accent-foreground"
                        : "border-border/60 bg-card text-muted-foreground"
                    }`}
                  >
                    <div className="text-sm font-medium">Queue</div>
                    <div className="text-[10px] text-muted-foreground/80">Add as follow-up</div>
                  </button>
                </div>
              </Field>
              <Field className="space-y-1.5">
                <FieldLabel className="text-xs text-muted-foreground">Message</FieldLabel>
                <Textarea
                  value={workerInputDraft}
                  onChange={(event) => setWorkerInputDraft(event.target.value)}
                  placeholder="Clarify the next step..."
                  className="min-h-[100px] border-border/40 bg-card/50 text-sm leading-relaxed"
                />
              </Field>
            </DialogPanel>
            <DialogFooter className="shrink-0 pt-4 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                className="text-xs"
                onClick={() => setSendInputDialogOpen(false)}
                disabled={isSendingWorkerInput}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSendingWorkerInput || !selectedWorker}
                className="px-4 text-xs"
              >
                {isSendingWorkerInput ? "Sending..." : "Send"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
