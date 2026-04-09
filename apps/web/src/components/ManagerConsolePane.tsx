import { ThreadId } from "@t3tools/contracts";
import { MANAGER_WORKER_MODEL_SELECTION } from "@t3tools/shared/manager";
import {
  ActivityIcon,
  BotIcon,
  ChevronLeftIcon,
  FileTextIcon,
  FolderOpenIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import { useCallback, useMemo, useState, type FormEvent } from "react";

import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { type Project, type Thread } from "../types";
import { Badge } from "./ui/badge";
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
  const [managerTitleDraft, setManagerTitleDraft] = useState(managerThread.title);
  const [isLaunchingWorker, setIsLaunchingWorker] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);

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
          modelSelection: MANAGER_WORKER_MODEL_SELECTION,
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
          modelSelection: MANAGER_WORKER_MODEL_SELECTION,
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
        setWorkerTitle("");
        setWorkerPrompt("");
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
    [activeProject.id, isLaunchingWorker, managerThread, workerPrompt, workerTitle],
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
      <div className="flex-1 space-y-8 overflow-y-auto px-1 py-1 pr-3">
        {/* Swarm Snapshot */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
              Project Swarm
            </h3>
            <span className="text-[10px] font-bold text-primary">{workerStats.total} WORKERS</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/40 bg-white/[0.02] p-3 transition-colors hover:border-border/60">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60">
                Active
              </div>
              <div className="mt-1 font-display text-lg font-semibold text-foreground">
                {workerStats.running}
              </div>
            </div>
            <div
              className={`rounded-lg border p-3 transition-colors ${
                workerStats.blocked > 0
                  ? "border-rose-500/30 bg-rose-500/5 hover:border-rose-500/50"
                  : "border-border/40 bg-white/[0.02] hover:border-border/60"
              }`}
            >
              <div
                className={`text-[9px] uppercase tracking-widest ${
                  workerStats.blocked > 0 ? "text-rose-400" : "text-muted-foreground/60"
                }`}
              >
                Blocked
              </div>
              <div
                className={`mt-1 font-display text-lg font-semibold ${
                  workerStats.blocked > 0 ? "text-rose-400" : "text-foreground"
                }`}
              >
                {workerStats.blocked}
              </div>
            </div>
          </div>
        </section>

        {/* Sacred Memory */}
        <section className="space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
            Sacred Memory
          </h3>
          <div className="space-y-2">
            <button
              type="button"
              disabled={!managerThread.managerScratchpad?.sessionLogPath}
              onClick={() => openPath(managerThread.managerScratchpad?.sessionLogPath, "Manager log")}
              className="group flex w-full items-center justify-between rounded-lg border border-border/40 bg-white/[0.02] p-2.5 transition-all hover:border-primary/30 hover:bg-white/[0.05]"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded border border-primary/20 bg-primary/5 text-primary">
                  <FileTextIcon className="size-3.5" />
                </div>
                <div className="min-w-0 text-left">
                  <div className="truncate text-xs font-medium text-foreground">session-log.md</div>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60">
                    Durable Audit
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-bold text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                OPEN
              </span>
            </button>
            <button
              type="button"
              disabled={!managerThread.managerScratchpad?.folderPath}
              onClick={() => openPath(managerThread.managerScratchpad?.folderPath, "Manager folder")}
              className="group flex w-full items-center justify-between rounded-lg border border-border/40 bg-white/[0.02] p-2.5 transition-all hover:border-primary/30 hover:bg-white/[0.05]"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded border border-primary/20 bg-primary/5 text-primary">
                  <FolderOpenIcon className="size-3.5" />
                </div>
                <div className="min-w-0 text-left">
                  <div className="truncate text-xs font-medium text-foreground">scratchpad/</div>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground/60">
                    Shared Memory
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-bold text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                OPEN
              </span>
            </button>
          </div>
        </section>

        {/* Workers */}
        <section className="space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
            Delegated Workers
          </h3>
          <div className="space-y-1.5">
            {workerThreads.length === 0 ? (
              <div className="rounded border border-dashed border-border/40 bg-white/[0.01] px-3 py-3 text-center text-[11px] text-muted-foreground/60">
                No active workers.
              </div>
            ) : (
              workerThreads.map((thread) => {
                const isBlocked =
                  thread.activities.some((activity) => activity.kind === "approval.requested") ||
                  thread.activities.some((activity) => activity.kind === "user-input.requested");
                const isRunning =
                  thread.session?.status === "running" ||
                  (thread.latestTurn !== null && thread.latestTurn.completedAt === null);

                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => onOpenThread(thread.id)}
                    className={`flex w-full items-center justify-between rounded border p-2.5 transition-all hover:bg-white/[0.04] ${
                      isBlocked
                        ? "border-rose-500/20 bg-rose-500/[0.03] hover:border-rose-500/40"
                        : "border-border/40 bg-white/[0.01]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span
                        className={`size-1.5 flex-shrink-0 rounded-full ${
                          isBlocked
                            ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                            : isRunning
                              ? "animate-pulse bg-primary shadow-[0_0_8px_rgba(251,113,133,0.6)]"
                              : "bg-muted-foreground/40"
                        }`}
                      />
                      <span
                        className={`truncate text-xs font-medium ${
                          isBlocked ? "text-rose-200" : "text-foreground/90"
                        }`}
                      >
                        {thread.title}
                      </span>
                    </div>
                    <span
                      className={`font-mono text-[9px] uppercase tracking-tighter ${
                        isBlocked ? "font-bold text-rose-400" : "text-muted-foreground/60"
                      }`}
                    >
                      {statusLabelForThread(thread)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <button
          type="button"
          onClick={() => setDelegateDialogOpen(true)}
          className="group flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
        >
          <PlusIcon className="size-3.5" />
          Delegate Worker
        </button>
      </div>

      <div className="mt-auto border-t border-border/40 p-2 pt-4">
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="outline"
            className="flex-1 bg-white/[0.02] font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 hover:bg-white/[0.06] hover:text-foreground"
            onClick={() => setRenameDialogOpen(true)}
          >
            <PencilIcon className="size-3 mt-[-1px]" />
            Rename
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="flex-1 bg-white/[0.02] font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 hover:bg-white/[0.06] hover:text-foreground"
          >
            <ActivityIcon className="size-3 mt-[-1px]" />
            Reconcile
          </Button>
        </div>
      </div>

      <Dialog open={delegateDialogOpen} onOpenChange={setDelegateDialogOpen}>
        <DialogPopup className="max-w-xl border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader className="border-b border-border/40 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded border border-primary/20 bg-primary/10 text-primary">
                <PlusIcon className="size-4" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg font-medium">Delegate Worker</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  Launch bounded execution
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <form onSubmit={launchDelegatedWorker}>
            <DialogPanel className="space-y-6 py-6 font-mono">
              <Field className="space-y-2">
                <FieldLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Worker Identity
                </FieldLabel>
                <Input
                  value={workerTitle}
                  onChange={(event) => setWorkerTitle(event.target.value)}
                  placeholder="e.g., auth-reconnect-fix"
                  className="border-border/40 bg-white/[0.02] font-mono text-sm focus:border-primary/40 focus:ring-primary/10"
                />
                <FieldDescription className="text-[10px] text-muted-foreground/50">
                  Short, operational slug for the swarm list.
                </FieldDescription>
              </Field>
              <Field className="space-y-2">
                <FieldLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Mission Assignment
                </FieldLabel>
                <Textarea
                  value={workerPrompt}
                  onChange={(event) => setWorkerPrompt(event.target.value)}
                  placeholder="Implement the fix, run verification, and reconcile outcome..."
                  className="min-h-[120px] border-border/40 bg-white/[0.02] font-mono text-sm leading-relaxed focus:border-primary/40 focus:ring-primary/10"
                />
                <FieldDescription className="text-[10px] text-muted-foreground/50">
                  Define scope, expected output, and verification steps.
                </FieldDescription>
              </Field>
            </DialogPanel>
            <DialogFooter className="border-t border-border/40 pt-4">
              <Button
                type="button"
                variant="outline"
                className="bg-transparent font-mono text-[10px] font-bold uppercase tracking-widest"
                onClick={() => setDelegateDialogOpen(false)}
                disabled={isLaunchingWorker}
              >
                Abort
              </Button>
              <Button
                type="submit"
                disabled={isLaunchingWorker}
                className="bg-primary px-6 font-mono text-[10px] font-bold uppercase tracking-widest text-background shadow-[0_0_15px_rgba(251,113,133,0.3)] hover:bg-primary/90"
              >
                {isLaunchingWorker ? "Launching Swarm..." : "Execute Mission"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogPopup className="max-w-lg border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader className="border-b border-border/40 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded border border-primary/20 bg-primary/10 text-primary">
                <PencilIcon className="size-4" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg font-medium">Identify Coordinator</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  Rename manager entity
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogPanel className="py-6 font-mono">
            <Field className="space-y-2">
              <FieldLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Durable Name
              </FieldLabel>
              <Input
                value={managerTitleDraft}
                onChange={(event) => setManagerTitleDraft(event.target.value)}
                placeholder="e.g., Frontend Lead"
                className="border-border/40 bg-white/[0.02] font-mono text-sm focus:border-primary/40"
              />
            </Field>
          </DialogPanel>
          <DialogFooter className="border-t border-border/40 pt-4">
            <Button
              type="button"
              variant="outline"
              className="bg-transparent font-mono text-[10px] font-bold uppercase tracking-widest"
              onClick={() => setRenameDialogOpen(false)}
              disabled={isSavingTitle}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveManagerTitle()}
              disabled={isSavingTitle}
              className="bg-primary px-6 font-mono text-[10px] font-bold uppercase tracking-widest text-background shadow-[0_0_15px_rgba(251,113,133,0.3)]"
            >
              {isSavingTitle ? "Updating..." : "Commit Name"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
