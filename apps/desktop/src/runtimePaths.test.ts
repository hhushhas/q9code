import { describe, expect, it } from "vitest";

import { resolveDesktopBaseDir } from "./runtimePaths";

describe("resolveDesktopBaseDir", () => {
  it("prefers Q9CODE_HOME when present", () => {
    expect(
      resolveDesktopBaseDir({
        env: { Q9CODE_HOME: "/tmp/q9-home", T3CODE_HOME: "/tmp/t3-home" },
        homedir: "/Users/hasan",
      }),
    ).toBe("/tmp/q9-home");
  });

  it("falls back to T3CODE_HOME when Q9CODE_HOME is unset", () => {
    expect(
      resolveDesktopBaseDir({
        env: { T3CODE_HOME: "/tmp/t3-home" },
        homedir: "/Users/hasan",
      }),
    ).toBe("/tmp/t3-home");
  });

  it("defaults to ~/.t3 so upstream and Q9 share threads by default", () => {
    expect(
      resolveDesktopBaseDir({
        env: {},
        homedir: "/Users/hasan",
      }),
    ).toBe("/Users/hasan/.t3");
  });
});
