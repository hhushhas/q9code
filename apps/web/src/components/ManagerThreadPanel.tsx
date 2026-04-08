import { ThreadId } from "@t3tools/contracts";
import { ArrowUpRightIcon, BotIcon, FolderOpenIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { readNativeApi } from "~/nativeApi";
import { type Project, type Thread } from "../types";
import { toastManager } from "./ui/toast";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

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
