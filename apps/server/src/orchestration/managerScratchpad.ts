import path from "node:path";

import { type OrchestrationThreadManagerScratchpad } from "@t3tools/contracts";
import { type ThreadId } from "@t3tools/contracts";

export function slugifyScratchpadSegment(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "project";
}

export function buildManagerScratchpad(input: {
  workspaceRoot: string;
  managerTitle: string;
}): OrchestrationThreadManagerScratchpad {
  const folderPath = path.join(
    input.workspaceRoot,
    "scratchpad",
    slugifyScratchpadSegment(input.managerTitle),
  );

  return {
    folderPath,
    sessionLogPath: path.join(folderPath, "manager-session-log.md"),
  };
}

export function buildWorkerScratchpadLogPath(input: {
  managerFolderPath: string;
  workerThreadId: ThreadId;
}): string {
  return path.join(input.managerFolderPath, "workers", `${input.workerThreadId}.md`);
}
