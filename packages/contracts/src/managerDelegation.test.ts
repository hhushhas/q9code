import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ManagerDelegationManifest, ManagerDelegationWorkerSnapshot } from "./managerDelegation";

const decodeManifest = Schema.decodeUnknownSync(ManagerDelegationManifest);
const decodeWorkerSnapshot = Schema.decodeUnknownSync(ManagerDelegationWorkerSnapshot);

describe("ManagerDelegationManifest", () => {
  it("decodes dependency-aware worker declarations with defaults", () => {
    expect(
      decodeManifest({
        summary: "Coordinate the next pass.",
        workers: [
          {
            id: "implement-fix",
            title: "Implement fix",
            prompt: "Land the reconnect patch.",
          },
          {
            id: "review",
            title: "Review",
            prompt: "Review the implementation diff.",
            kind: "review",
            dependsOn: ["implement-fix"],
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4-mini",
              options: {
                reasoningEffort: "medium",
                fastMode: true,
              },
            },
          },
        ],
      }),
    ).toEqual({
      summary: "Coordinate the next pass.",
      workers: [
        {
          id: "implement-fix",
          title: "Implement fix",
          prompt: "Land the reconnect patch.",
          kind: "general",
          dependsOn: [],
        },
        {
          id: "review",
          title: "Review",
          prompt: "Review the implementation diff.",
          kind: "review",
          dependsOn: ["implement-fix"],
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4-mini",
            options: {
              reasoningEffort: "medium",
              fastMode: true,
            },
          },
        },
      ],
    });
  });

  it("rejects invalid worker ids", () => {
    expect(() =>
      decodeManifest({
        workers: [
          {
            id: "review worker",
            title: "Review",
            prompt: "Review the diff.",
          },
        ],
      }),
    ).toThrowError();
  });
});

describe("ManagerDelegationWorkerSnapshot", () => {
  it("decodes dependency-state snapshots for projected worker orchestration", () => {
    expect(
      decodeWorkerSnapshot({
        workerId: "release",
        threadId: "thread-release",
        state: "waiting_on_dependencies",
        blockingWorkerIds: ["review"],
      }),
    ).toEqual({
      workerId: "release",
      threadId: "thread-release",
      state: "waiting_on_dependencies",
      blockingWorkerIds: ["review"],
    });
  });
});
