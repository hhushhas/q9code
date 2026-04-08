import path from "node:path";

import { type OrchestrationThreadManagerScratchpad } from "@t3tools/contracts";

function slugifySegment(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "project";
}

export function buildManagerScratchpad(input: {
  workspaceRoot: string;
  projectTitle: string;
}): OrchestrationThreadManagerScratchpad {
  const workspaceName = path.basename(input.workspaceRoot);
  const projectSlug = slugifySegment(workspaceName.length > 0 ? workspaceName : input.projectTitle);
  const folderPath = path.join(input.workspaceRoot, "scratchpad", "managers", projectSlug);

  return {
    folderPath,
    sessionLogPath: path.join(folderPath, "manager-session-log.md"),
  };
}
