import { ThreadId } from "@t3tools/contracts";
import { ArrowUpRightIcon, BotIcon, FolderOpenIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { readNativeApi } from "~/nativeApi";
import { type Project, type Thread } from "../types";
import { toastManager } from "./ui/toast";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

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

  if (!managerThread || !activeProject) {
    return null;
  }

  if (activeThread.role === "manager") {
    return null;
  }

  return (
    <div className="mx-auto mb-6 w-full max-w-[52rem] rounded-xl border border-border/60 bg-card/50 p-4 font-mono transition-colors hover:border-border">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded border border-border/60 bg-secondary text-secondary-foreground">
            <BotIcon className="size-4" />
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
              Coordinated by
            </div>
            <div className="font-display text-sm font-medium text-foreground">
              {managerThread.title}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-border/60 bg-muted font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground"
          >
            {workerThreads.length} Swarm Workers
          </Badge>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          className="bg-secondary font-mono text-[10px] font-bold uppercase tracking-widest hover:bg-secondary/80"
          onClick={() => onOpenThread(managerThread.id)}
        >
          <ArrowUpRightIcon className="size-3 mt-[-1px]" />
          Return to Manager
        </Button>
        <Button
          size="xs"
          variant="outline"
          className="bg-secondary font-mono text-[10px] font-bold uppercase tracking-widest hover:bg-secondary/80"
          disabled={!managerThread.managerScratchpad?.folderPath}
          onClick={() => openPath(managerThread.managerScratchpad?.folderPath, "Manager folder")}
        >
          <FolderOpenIcon className="size-3 mt-[-1px]" />
          Shared Scratchpad
        </Button>
      </div>
    </div>
  );
}
