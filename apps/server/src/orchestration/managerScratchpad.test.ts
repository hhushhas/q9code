import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildManagerScratchpad } from "./managerScratchpad.ts";

describe("buildManagerScratchpad", () => {
  it("scopes manager scratchpad paths with manager thread identity", () => {
    const managerScratchpad = buildManagerScratchpad({
      workspaceRoot: "/tmp/q9-code",
      managerTitle: "Atlas Coordinator",
      managerThreadId: ThreadId.makeUnsafe("thread-manager-1"),
    });

    expect(managerScratchpad).toEqual({
      folderPath: "/tmp/q9-code/scratchpad/atlas-coordinator-thread-manager-1",
      sessionLogPath:
        "/tmp/q9-code/scratchpad/atlas-coordinator-thread-manager-1/manager-session-log.md",
    });
  });

  it("keeps scratchpad paths distinct when managers share the same title", () => {
    const first = buildManagerScratchpad({
      workspaceRoot: "/tmp/q9-code",
      managerTitle: "Project manager",
      managerThreadId: ThreadId.makeUnsafe("thread-manager-a"),
    });
    const second = buildManagerScratchpad({
      workspaceRoot: "/tmp/q9-code",
      managerTitle: "Project manager",
      managerThreadId: ThreadId.makeUnsafe("thread-manager-b"),
    });

    expect(first.folderPath).not.toBe(second.folderPath);
    expect(first.sessionLogPath).not.toBe(second.sessionLogPath);
  });
});
