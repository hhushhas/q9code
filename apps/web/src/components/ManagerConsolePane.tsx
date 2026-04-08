import { ThreadId } from "@t3tools/contracts";
import { MANAGER_WORKER_MODEL_SELECTION } from "@t3tools/shared/manager";
import {
  ActivityIcon,
  BotIcon,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
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
import { Separator } from "./ui/separator";
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

  const managerActivities = useMemo(
    () =>
      (managerThread.activities ?? [])
        .filter((activity) => activity.kind.startsWith("manager."))
        .slice(-8)
        .reverse(),
    [managerThread.activities],
  );

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
    <>
      <Card className="border-border/80 bg-card/92 shadow-none">
        <CardHeader className="gap-3 border-b border-border/70 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Project Manager
              </div>
              <CardTitle className="mt-1 flex items-center gap-2 font-mono text-base font-medium">
                <BotIcon className="size-4 text-primary" />
                {managerThread.title}
              </CardTitle>
              <CardDescription className="mt-1 max-w-sm font-mono text-xs text-muted-foreground">
                One control plane for the project. Keep continuity in the sacred log, review worker
                status at a glance, and delegate bounded execution when needed.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-border/70 bg-transparent font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
              >
                {activeProject.name}
              </Badge>
              <Badge
                variant="outline"
                className="border-border/70 bg-transparent font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
              >
                {workerStats.total} workers
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={() => setDelegateDialogOpen(true)}>
              <PlusIcon className="size-3.5" />
              Delegate worker
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setManagerTitleDraft(managerThread.title);
                setRenameDialogOpen(true);
              }}
            >
              <PencilIcon className="size-3.5" />
              Rename manager
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={!managerThread.managerScratchpad?.folderPath}
              onClick={() =>
                openPath(managerThread.managerScratchpad?.folderPath, "Manager folder")
              }
            >
              <FolderOpenIcon className="size-3.5" />
              Open folder
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={!managerThread.managerScratchpad?.sessionLogPath}
              onClick={() =>
                openPath(managerThread.managerScratchpad?.sessionLogPath, "Manager log")
              }
            >
              <FileTextIcon className="size-3.5" />
              Open log
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-muted/14 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Swarm Snapshot
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
                <div className="rounded-lg border border-border/60 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Running
                  </div>
                  <div className="mt-1 text-foreground">{workerStats.running}</div>
                </div>
                <div className="rounded-lg border border-border/60 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Blocked
                  </div>
                  <div className="mt-1 text-foreground">{workerStats.blocked}</div>
                </div>
                <div className="rounded-lg border border-border/60 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Completed
                  </div>
                  <div className="mt-1 text-foreground">{workerStats.completed}</div>
                </div>
                <div className="rounded-lg border border-border/60 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Total
                  </div>
                  <div className="mt-1 text-foreground">{workerStats.total}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/14 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Sacred Memory
              </div>
              <div className="mt-2 space-y-2 font-mono text-[11px] leading-5 text-foreground/88">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Folder
                  </div>
                  <div className="break-all">
                    {managerThread.managerScratchpad?.folderPath ?? "Not available yet"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Session log
                  </div>
                  <div className="break-all">
                    {managerThread.managerScratchpad?.sessionLogPath ?? "Not available yet"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Workers
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                What is happening should stay legible at a glance.
              </div>
            </div>
            {workerThreads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/12 px-3 py-3 font-mono text-xs text-muted-foreground">
                No workers yet. Delegate from here when you want the manager to assign execution.
              </div>
            ) : (
              <div className="space-y-2">
                {workerThreads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/18"
                    onClick={() => onOpenThread(thread.id)}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="font-mono text-sm text-foreground">{thread.title}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {statusLabelForThread(thread)} · updated{" "}
                        {formatRelativeTimeLabel(thread.updatedAt ?? thread.createdAt)}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-border/70 bg-transparent font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      Open
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <ActivityIcon className="size-3.5" />
              Recent manager activity
            </div>
            {managerActivities.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/12 px-3 py-3 font-mono text-xs text-muted-foreground">
                The manager activity stream will populate as workers launch, complete, or get
                blocked.
              </div>
            ) : (
              managerActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="rounded-xl border border-border/70 bg-muted/10 px-3 py-2.5 font-mono text-xs text-foreground/88"
                >
                  <div>{activity.summary}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {formatRelativeTimeLabel(activity.createdAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={delegateDialogOpen} onOpenChange={setDelegateDialogOpen}>
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Delegate worker</DialogTitle>
            <DialogDescription>
              Launch a bounded worker without leaving the manager thread.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={launchDelegatedWorker}>
            <DialogPanel className="space-y-4">
              <Field>
                <FieldLabel>Worker title</FieldLabel>
                <Input
                  value={workerTitle}
                  onChange={(event) => setWorkerTitle(event.target.value)}
                  placeholder="Reconnect patch"
                />
                <FieldDescription>
                  Keep it short and operational so the worker list stays readable.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Assignment</FieldLabel>
                <Textarea
                  value={workerPrompt}
                  onChange={(event) => setWorkerPrompt(event.target.value)}
                  placeholder="Implement the reconnect fix, run the relevant verification steps, and report the outcome."
                />
                <FieldDescription>
                  Be concrete about scope, expected output, and verification.
                </FieldDescription>
              </Field>
            </DialogPanel>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDelegateDialogOpen(false)}
                disabled={isLaunchingWorker}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLaunchingWorker}>
                {isLaunchingWorker ? "Launching..." : "Launch worker"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rename manager</DialogTitle>
            <DialogDescription>
              Give this project manager a durable, human-readable identity.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <Field>
              <FieldLabel>Manager name</FieldLabel>
              <Input
                value={managerTitleDraft}
                onChange={(event) => setManagerTitleDraft(event.target.value)}
                placeholder="Frontend coordinator"
              />
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
              disabled={isSavingTitle}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveManagerTitle()} disabled={isSavingTitle}>
              {isSavingTitle ? "Saving..." : "Save name"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
