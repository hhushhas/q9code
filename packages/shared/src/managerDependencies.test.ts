import { describe, expect, it } from "vitest";

import {
  buildInitialManagerDelegationSnapshots,
  collectManagerDelegationIssues,
  parseManagerDelegationManifest,
  resolveManagerDelegationSnapshots,
} from "./managerDependencies";

describe("parseManagerDelegationManifest", () => {
  it("decodes dependency-aware manager delegation payloads", () => {
    expect(
      parseManagerDelegationManifest({
        summary: "Coordinate implementation, review, and release.",
        workers: [
          {
            id: "implement",
            title: "Implement",
            prompt: "Land the fix.",
          },
          {
            id: "review",
            title: "Review",
            prompt: "Review the landed fix.",
            kind: "review",
            dependsOn: ["implement"],
          },
        ],
      }),
    ).toEqual({
      summary: "Coordinate implementation, review, and release.",
      workers: [
        {
          id: "implement",
          title: "Implement",
          prompt: "Land the fix.",
          kind: "general",
          dependsOn: [],
        },
        {
          id: "review",
          title: "Review",
          prompt: "Review the landed fix.",
          kind: "review",
          dependsOn: ["implement"],
        },
      ],
    });
  });
});

describe("collectManagerDelegationIssues", () => {
  it("flags gate-sensitive workers without dependencies", () => {
    const manifest = parseManagerDelegationManifest({
      workers: [
        {
          id: "release",
          title: "Release",
          prompt: "Ship the build.",
          kind: "release",
        },
      ],
    });

    expect(manifest).not.toBeNull();
    expect(collectManagerDelegationIssues(manifest!)).toEqual([
      {
        code: "gate_sensitive_requires_dependency",
        workerId: "release",
        detail: "Gate-sensitive worker 'release' (release) must declare at least one dependency.",
      },
    ]);
  });

  it("flags cycles and unknown dependencies", () => {
    const manifest = parseManagerDelegationManifest({
      workers: [
        {
          id: "a",
          title: "Worker A",
          prompt: "Do A.",
          dependsOn: ["b"],
        },
        {
          id: "b",
          title: "Worker B",
          prompt: "Do B.",
          dependsOn: ["a", "missing"],
        },
      ],
    });

    expect(manifest).not.toBeNull();
    expect(collectManagerDelegationIssues(manifest!)).toEqual([
      {
        code: "unknown_dependency",
        workerId: "b",
        detail: "Worker 'b' depends on unknown worker 'missing'.",
      },
      {
        code: "dependency_cycle",
        workerId: "a",
        detail: "Worker 'a' is part of a dependency cycle.",
      },
      {
        code: "dependency_cycle",
        workerId: "b",
        detail: "Worker 'b' is part of a dependency cycle.",
      },
    ]);
  });
});

describe("manager delegation snapshots", () => {
  it("starts valid declarations in planned state", () => {
    const manifest = parseManagerDelegationManifest({
      workers: [
        {
          id: "implement",
          title: "Implement",
          prompt: "Land the fix.",
        },
      ],
    });

    expect(manifest).not.toBeNull();
    expect(buildInitialManagerDelegationSnapshots(manifest!)).toEqual([
      {
        workerId: "implement",
        threadId: null,
        state: "planned",
        blockingWorkerIds: [],
      },
    ]);
  });

  it("resolves dependency-driven launch states", () => {
    const manifest = parseManagerDelegationManifest({
      workers: [
        {
          id: "implement",
          title: "Implement",
          prompt: "Land the fix.",
        },
        {
          id: "review",
          title: "Review",
          prompt: "Review the fix.",
          kind: "review",
          dependsOn: ["implement"],
        },
        {
          id: "release",
          title: "Release",
          prompt: "Ship the fix.",
          kind: "release",
          dependsOn: ["review"],
        },
      ],
    });

    expect(manifest).not.toBeNull();
    expect(
      resolveManagerDelegationSnapshots({
        manifest: manifest!,
        runtimeStates: {
          implement: { threadId: "thread-implement" as never, state: "completed" },
          review: { threadId: "thread-review" as never, state: "running" },
        },
      }),
    ).toEqual([
      {
        workerId: "implement",
        threadId: "thread-implement",
        state: "completed",
        blockingWorkerIds: [],
      },
      {
        workerId: "review",
        threadId: "thread-review",
        state: "running",
        blockingWorkerIds: [],
      },
      {
        workerId: "release",
        threadId: null,
        state: "waiting_on_dependencies",
        blockingWorkerIds: ["review"],
      },
    ]);
  });
});
