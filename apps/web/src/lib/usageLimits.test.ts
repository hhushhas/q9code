import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveLatestUsageLimitSnapshot,
  formatUsageLimitPercentage,
  formatUsageLimitResetAt,
  formatUsageLimitWindowLabel,
} from "./usageLimits";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.makeUnsafe("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("usageLimits", () => {
  it("derives the latest valid usage-limit snapshot", () => {
    const snapshot = deriveLatestUsageLimitSnapshot([
      makeActivity("activity-1", "usage-limit.updated", {
        primary: {
          usedPercent: 12,
          windowDurationMins: 300,
        },
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "usage-limit.updated", {
        limitId: "codex",
        primary: {
          usedPercent: 42,
          windowDurationMins: 300,
          resetsAt: 1_776_000_000,
        },
        secondary: {
          usedPercent: 9,
          windowDurationMins: 10_080,
          resetsAt: 1_776_432_000,
        },
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: "$18.41",
        },
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.limitId).toBe("codex");
    expect(snapshot?.activeWindow.usedPercentage).toBe(42);
    expect(snapshot?.primary?.windowDurationMins).toBe(300);
    expect(snapshot?.secondary?.windowDurationMins).toBe(10_080);
    expect(snapshot?.credits?.balance).toBe("$18.41");
  });

  it("ignores malformed usage-limit payloads", () => {
    const snapshot = deriveLatestUsageLimitSnapshot([
      makeActivity("activity-1", "usage-limit.updated", {
        primary: {},
      }),
    ]);

    expect(snapshot).toBeNull();
  });

  it("formats usage-limit labels, percentages, and reset times", () => {
    expect(formatUsageLimitWindowLabel(300, "5-hour")).toBe("5-hour");
    expect(formatUsageLimitWindowLabel(10_080, "weekly")).toBe("weekly");
    expect(formatUsageLimitPercentage(9.4)).toBe("9.4%");
    expect(formatUsageLimitPercentage(42)).toBe("42%");
    expect(formatUsageLimitResetAt(1_776_000_000, new Date("2026-04-10T10:00:00.000Z"))).not.toBe(
      null,
    );
  });
});
