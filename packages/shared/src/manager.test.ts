import { describe, expect, it } from "vitest";

import {
  extractWorkerFinal,
  extractManagerDelegation,
  stripManagerControlMarkup,
  stripManagerDelegation,
  stripWorkerFinal,
  MANAGER_DELEGATION_CLOSE_TAG,
  MANAGER_DELEGATION_OPEN_TAG,
  WORKER_FINAL_CLOSE_TAG,
  WORKER_FINAL_OPEN_TAG,
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
          { title: "Patch resume flow", prompt: "Implement the reconnect fix." },
        ],
      }),
      MANAGER_DELEGATION_CLOSE_TAG,
    ].join("\n");

    expect(extractManagerDelegation(text)).toEqual({
      summary: "Split the work",
      workers: [
        { title: "Investigate reconnects", prompt: "Trace the reconnect failure path." },
        { title: "Patch resume flow", prompt: "Implement the reconnect fix." },
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
  it("parses the last worker final block", () => {
    const text = [
      "Progress update.",
      WORKER_FINAL_OPEN_TAG,
      "First final",
      WORKER_FINAL_CLOSE_TAG,
      WORKER_FINAL_OPEN_TAG,
      "Patched manager wake-ups and verified the regression coverage.",
      WORKER_FINAL_CLOSE_TAG,
    ].join("\n");

    expect(extractWorkerFinal(text)).toBe(
      "Patched manager wake-ups and verified the regression coverage.",
    );
  });

  it("unwraps worker final content for visible rendering", () => {
    const text = [
      "Sharing the final handoff below.",
      "",
      WORKER_FINAL_OPEN_TAG,
      "Patched manager wake-ups and verified the regression coverage.",
      WORKER_FINAL_CLOSE_TAG,
    ].join("\n");

    expect(stripWorkerFinal(text)).toBe(
      "Sharing the final handoff below.\n\nPatched manager wake-ups and verified the regression coverage.",
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
      WORKER_FINAL_OPEN_TAG,
      "Final worker handoff.",
      WORKER_FINAL_CLOSE_TAG,
    ].join("\n");

    expect(stripManagerControlMarkup(text)).toBe("Done coordinating.\n\nFinal worker handoff.");
  });
});
