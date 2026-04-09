import { describe, expect, it } from "vitest";

import {
  extractManagerChecklist,
  extractWorkerOutcome,
  extractWorkerFinal,
  extractManagerDelegation,
  MANAGER_CHECKLIST_FENCE,
  pickDefaultManagerThreadTitle,
  resolveManagerThreadTitle,
  stripManagerControlMarkup,
  stripManagerDelegation,
  stripWorkerFinal,
  MANAGER_DELEGATION_CLOSE_TAG,
  MANAGER_DELEGATION_OPEN_TAG,
  WORKER_BLOCKED_CLOSE_TAG,
  WORKER_BLOCKED_OPEN_TAG,
  WORKER_COMPLETE_CLOSE_TAG,
  WORKER_COMPLETE_OPEN_TAG,
} from "./manager";

describe("extractManagerDelegation", () => {
  it("parses the last valid delegation block", () => {
    const text = [
      "Coordinating the next step.",
      MANAGER_DELEGATION_OPEN_TAG,
      JSON.stringify({
        summary: "Split the work",
        workers: [
          { title: "Investigate reconnects", prompt: "Trace the reconnect failure path." },
          {
            title: "Patch resume flow",
            prompt: "Implement the reconnect fix.",
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
      MANAGER_DELEGATION_CLOSE_TAG,
    ].join("\n");

    expect(extractManagerDelegation(text)).toEqual({
      summary: "Split the work",
      workers: [
        {
          id: "investigate-reconnects",
          title: "Investigate reconnects",
          prompt: "Trace the reconnect failure path.",
          kind: "general",
          dependsOn: [],
        },
        {
          id: "patch-resume-flow",
          title: "Patch resume flow",
          prompt: "Implement the reconnect fix.",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4-mini",
            options: {
              reasoningEffort: "medium",
              fastMode: true,
            },
          },
          kind: "general",
          dependsOn: [],
        },
      ],
    });
  });

  it("returns null when the block is missing or invalid", () => {
    expect(extractManagerDelegation("No delegation here.")).toBeNull();
    expect(
      extractManagerDelegation(
        `${MANAGER_DELEGATION_OPEN_TAG}\nnot-json\n${MANAGER_DELEGATION_CLOSE_TAG}`,
      ),
    ).toBeNull();
  });

  it("keeps parsing legacy title/prompt-only delegation blocks", () => {
    const text = [
      MANAGER_DELEGATION_OPEN_TAG,
      JSON.stringify({
        workers: [{ title: "Legacy worker", prompt: "Handle the older manager format." }],
      }),
      MANAGER_DELEGATION_CLOSE_TAG,
    ].join("\n");

    expect(extractManagerDelegation(text)).toEqual({
      workers: [
        {
          id: "legacy-worker",
          title: "Legacy worker",
          prompt: "Handle the older manager format.",
          kind: "general",
          dependsOn: [],
        },
      ],
    });
  });
});

describe("stripManagerDelegation", () => {
  it("removes the delegation block from the visible response", () => {
    const text = [
      "I delegated this cleanly.",
      "",
      MANAGER_DELEGATION_OPEN_TAG,
      JSON.stringify({
        workers: [{ title: "Worker", prompt: "Do the work." }],
      }),
      MANAGER_DELEGATION_CLOSE_TAG,
    ].join("\n");

    expect(stripManagerDelegation(text)).toBe("I delegated this cleanly.");
  });
});

describe("worker final helpers", () => {
  it("parses the last worker outcome block", () => {
    const text = [
      "Progress update.",
      WORKER_BLOCKED_OPEN_TAG,
      "Need approval before I can modify production config.",
      WORKER_BLOCKED_CLOSE_TAG,
      WORKER_COMPLETE_OPEN_TAG,
      "Patched manager wake-ups and verified the regression coverage.",
      WORKER_COMPLETE_CLOSE_TAG,
    ].join("\n");

    expect(extractWorkerOutcome(text)).toEqual({
      kind: "complete",
      content: "Patched manager wake-ups and verified the regression coverage.",
    });
    expect(extractWorkerFinal(text)).toBe(
      "Patched manager wake-ups and verified the regression coverage.",
    );
  });

  it("parses blocked worker outcomes", () => {
    const text = [
      "Progress update.",
      WORKER_BLOCKED_OPEN_TAG,
      "I need the manager to decide whether to interrupt the running worker.",
      WORKER_BLOCKED_CLOSE_TAG,
    ].join("\n");

    expect(extractWorkerOutcome(text)).toEqual({
      kind: "blocked",
      content: "I need the manager to decide whether to interrupt the running worker.",
    });
    expect(extractWorkerFinal(text)).toBeNull();
  });

  it("unwraps worker outcome content for visible rendering", () => {
    const text = [
      "Sharing the final handoff below.",
      "",
      WORKER_COMPLETE_OPEN_TAG,
      "Patched manager wake-ups and verified the regression coverage.",
      WORKER_COMPLETE_CLOSE_TAG,
      "",
      WORKER_BLOCKED_OPEN_TAG,
      "I still need confirmation on the rollout plan.",
      WORKER_BLOCKED_CLOSE_TAG,
    ].join("\n");

    expect(stripWorkerFinal(text)).toBe(
      [
        "Sharing the final handoff below.",
        "",
        "Patched manager wake-ups and verified the regression coverage.",
        "",
        "I still need confirmation on the rollout plan.",
      ].join("\n"),
    );
  });

  it("strips manager control markup for visible assistant text", () => {
    const text = [
      "Done coordinating.",
      "",
      MANAGER_DELEGATION_OPEN_TAG,
      JSON.stringify({
        workers: [{ title: "Worker", prompt: "Do the work." }],
      }),
      MANAGER_DELEGATION_CLOSE_TAG,
      "",
      WORKER_COMPLETE_OPEN_TAG,
      "Final worker handoff.",
      WORKER_COMPLETE_CLOSE_TAG,
    ].join("\n");

    expect(stripManagerControlMarkup(text)).toBe("Done coordinating.\n\nFinal worker handoff.");
  });
});

describe("manager checklist helpers", () => {
  it("parses the latest dedicated manager checklist fence", () => {
    const text = [
      "Earlier note",
      "```manager-checklist",
      "- [ ] Old item",
      "```",
      "",
      `\`\`\`${MANAGER_CHECKLIST_FENCE}`,
      "- [x] Capture worker outcome semantics",
      "- [ ] Land manager-to-worker input controls",
      "1. [ ] Render the checklist in the console",
      "```",
    ].join("\n");

    expect(extractManagerChecklist(text)).toEqual({
      raw: [
        "- [x] Capture worker outcome semantics",
        "- [ ] Land manager-to-worker input controls",
        "1. [ ] Render the checklist in the console",
      ].join("\n"),
      items: [
        { text: "Capture worker outcome semantics", checked: true },
        { text: "Land manager-to-worker input controls", checked: false },
        { text: "Render the checklist in the console", checked: false },
      ],
    });
  });

  it("returns null when the dedicated checklist fence is missing or has no tasks", () => {
    expect(extractManagerChecklist("No checklist block here.")).toBeNull();
    expect(
      extractManagerChecklist([`\`\`\`${MANAGER_CHECKLIST_FENCE}`, "plain text", "```"].join("\n")),
    ).toBeNull();
  });
});

describe("manager naming helpers", () => {
  it("replaces the legacy generic manager title with a curated default", () => {
    expect(resolveManagerThreadTitle({ requestedTitle: "Project manager", seed: "thread-1" })).toBe(
      pickDefaultManagerThreadTitle("thread-1"),
    );
  });

  it("preserves explicit custom manager titles", () => {
    expect(
      resolveManagerThreadTitle({
        requestedTitle: "Spacious manager architecture diagram",
        seed: "thread-1",
      }),
    ).toBe("Spacious manager architecture diagram");
  });
});
