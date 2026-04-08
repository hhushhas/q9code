import { ThreadId } from "@t3tools/contracts";
import { MANAGER_WORKER_MODEL_SELECTION } from "@t3tools/shared/manager";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { ArrowUpRightIcon, BotIcon, FileTextIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState, type FormEvent } from "react";

import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { type Project, type Thread } from "../types";
import { toastManager } from "./ui/toast";
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

function statusLabelForThread(thread: Thread): string {
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
  return "Idle";
}

function sortWorkers(left: Thread, right: Thread): number {
  const leftUpdatedAt = left.updatedAt ?? left.createdAt;
  const rightUpdatedAt = right.updatedAt ?? right.createdAt;
  return rightUpdatedAt.localeCompare(leftUpdatedAt) || left.title.localeCompare(right.title);
}

export function ManagerThreadPanel({
  activeThread,
  activeProject,
  projectThreads,
  onOpenThread,
}: {
  activeThread: Thread;
  activeProject: Project | undefined;
  projectThreads: readonly Thread[];
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const [delegateDialogOpen, setDelegateDialogOpen] = useState(false);
  const [workerTitle, setWorkerTitle] = useState("");
  const [workerPrompt, setWorkerPrompt] = useState("");
  const [isLaunchingWorker, setIsLaunchingWorker] = useState(false);

  const managerThread = useMemo(() => {
    if (activeThread.role === "manager") {
      return activeThread;
    }
    if (activeThread.managerThreadId === null) {
      return null;
    }
    return projectThreads.find((thread) => thread.id === activeThread.managerThreadId) ?? null;
  }, [activeThread, projectThreads]);

  const workerThreads = useMemo(
    () =>
      managerThread
        ? projectThreads
            .filter(
              (thread) => thread.managerThreadId === managerThread.id && thread.archivedAt === null,
            )
            .toSorted(sortWorkers)
        : [],
    [managerThread, projectThreads],
  );

  const managerActivities = useMemo(
    () =>
      (managerThread?.activities ?? [])
        .filter((activity) => activity.kind.startsWith("manager."))
        .slice(-4)
        .reverse(),
    [managerThread?.activities],
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
      if (!activeProject || !managerThread || isLaunchingWorker) {
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
    [activeProject, isLaunchingWorker, managerThread, workerPrompt, workerTitle],
  );

  if (!managerThread || !activeProject) {
    return null;
  }

  if (activeThread.role !== "manager") {
    return (
      <Card className="mx-auto mb-4 w-full max-w-[52rem] border-border/80 bg-card/90 shadow-none">
        <CardHeader className="gap-2 border-b border-border/70 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Managed Thread
              </div>
              <CardTitle className="mt-1 flex items-center gap-2 font-mono text-base font-medium">
                <BotIcon className="size-4 text-primary" />
                {managerThread.title}
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl font-mono text-xs text-muted-foreground">
                This worker reports into the project manager and inherits its sacred folder and log.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="border-border/70 bg-transparent font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
            >
              {workerThreads.length} workers
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 px-4 py-4">
          <Button size="xs" variant="outline" onClick={() => onOpenThread(managerThread.id)}>
            <ArrowUpRightIcon className="size-3.5" />
            Open manager
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!managerThread.managerScratchpad?.folderPath}
            onClick={() => openPath(managerThread.managerScratchpad?.folderPath, "Manager folder")}
          >
            <FolderOpenIcon className="size-3.5" />
            Open folder
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="mx-auto mb-4 w-full max-w-[52rem] border-border/80 bg-card/90 shadow-none">
        <CardHeader className="gap-2 border-b border-border/70 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Project Manager
              </div>
              <CardTitle className="mt-1 flex items-center gap-2 font-mono text-base font-medium">
                <BotIcon className="size-4 text-primary" />
                {managerThread.title}
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl font-mono text-xs text-muted-foreground">
                Coordinate the project here, keep continuity in the sacred log, and launch bounded
                workers when implementation is needed.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-border/70 bg-transparent font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
              >
                {workerThreads.length} workers
              </Badge>
              <Badge
                variant="outline"
                className="border-border/70 bg-transparent font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
              >
                {activeProject.name}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={() => setDelegateDialogOpen(true)}>
              <PlusIcon className="size-3.5" />
              Delegate worker
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

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-muted/16 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Sacred folder
              </div>
              <div className="mt-2 break-all font-mono text-[11px] leading-5 text-foreground/88">
                {managerThread.managerScratchpad?.folderPath ?? "Not available yet"}
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/16 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Session log
              </div>
              <div className="mt-2 break-all font-mono text-[11px] leading-5 text-foreground/88">
                {managerThread.managerScratchpad?.sessionLogPath ?? "Not available yet"}
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
                Audit remains centralized here.
              </div>
            </div>
            {workerThreads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/12 px-3 py-3 font-mono text-xs text-muted-foreground">
                No workers yet. Delegate from here when you want the manager to assign execution.
              </div>
            ) : (
              <div className="space-y-2">
                {workerThreads.map((thread) => (
                  <div
                    key={thread.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/12 px-3 py-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="font-mono text-sm text-foreground">{thread.title}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {statusLabelForThread(thread)} · updated{" "}
                        {formatRelativeTimeLabel(thread.updatedAt ?? thread.createdAt)}
                      </div>
                    </div>
                    <Button size="xs" variant="ghost" onClick={() => onOpenThread(thread.id)}>
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {managerActivities.length > 0 ? (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Recent manager activity
                </div>
                {managerActivities.map((activity) => (
                  <div
                    key={activity.id}
                    className="rounded-xl border border-border/70 bg-muted/12 px-3 py-2.5 font-mono text-xs text-foreground/88"
                  >
                    <div>{activity.summary}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {formatRelativeTimeLabel(activity.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
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
                {isLaunchingWorker ? "Launching…" : "Launch worker"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
