import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { extractChangedFiles, extractChangedFilesFromActivities } from "./changedFiles";

function makeActivity(overrides: {
  id?: string;
  payload?: Record<string, unknown>;
  turnId?: string;
}): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(overrides.id ?? crypto.randomUUID()),
    createdAt: "2026-04-09T00:00:00.000Z",
    kind: "tool.updated",
    summary: "Tool updated",
    tone: "tool",
    payload: overrides.payload ?? {},
    turnId: overrides.turnId ? TurnId.makeUnsafe(overrides.turnId) : null,
  };
}

describe("changedFiles", () => {
  it("extracts changed paths from nested tool payload data", () => {
    expect(
      extractChangedFiles({
        item: {
          changes: [{ path: "apps/server/src/ws.ts" }, { filename: "apps/web/src/ChatView.tsx" }],
        },
      }),
    ).toEqual(["apps/server/src/ws.ts", "apps/web/src/ChatView.tsx"]);
  });

  it("scopes changed files to the matching turn activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "a",
        turnId: "turn-a",
        payload: {
          data: {
            item: {
              changes: [{ path: "worker-a.ts" }],
            },
          },
        },
      }),
      makeActivity({
        id: "b",
        turnId: "turn-b",
        payload: {
          data: {
            item: {
              changes: [{ path: "worker-b.ts" }],
            },
          },
        },
      }),
    ];

    expect(extractChangedFilesFromActivities(activities, TurnId.makeUnsafe("turn-a"))).toEqual([
      "worker-a.ts",
    ]);
  });
});
