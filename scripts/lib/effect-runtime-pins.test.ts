import { describe, expect, it } from "vitest";

import { ensureEffectRuntimeDependencyPins } from "./effect-runtime-pins.ts";

describe("ensureEffectRuntimeDependencyPins", () => {
  it("pins @effect/platform-node-shared to @effect/platform-node when shared is missing", () => {
    const result = ensureEffectRuntimeDependencyPins({
      effect: "4.0.0-beta.43",
      "@effect/platform-node": "4.0.0-beta.43",
    });

    expect(result).toEqual({
      effect: "4.0.0-beta.43",
      "@effect/platform-node": "4.0.0-beta.43",
      "@effect/platform-node-shared": "4.0.0-beta.43",
    });
  });

  it("does not override an explicit @effect/platform-node-shared version", () => {
    const result = ensureEffectRuntimeDependencyPins({
      effect: "4.0.0-beta.43",
      "@effect/platform-node": "4.0.0-beta.43",
      "@effect/platform-node-shared": "4.0.0-beta.44",
    });

    expect(result).toEqual({
      effect: "4.0.0-beta.43",
      "@effect/platform-node": "4.0.0-beta.43",
      "@effect/platform-node-shared": "4.0.0-beta.44",
    });
  });

  it("leaves dependencies unchanged when @effect/platform-node is absent", () => {
    const result = ensureEffectRuntimeDependencyPins({
      effect: "4.0.0-beta.43",
    });

    expect(result).toEqual({
      effect: "4.0.0-beta.43",
    });
  });
});
