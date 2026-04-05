import { assert, describe, it } from "vitest";

import {
  HASAN_SIGNATURE_THEME_CLASS,
  isTheme,
  resolveDesktopTheme,
  resolveTheme,
  resolveThemeClassName,
} from "./theme";

describe("theme helpers", () => {
  it("accepts Hasan Signature as a valid theme", () => {
    assert.isTrue(isTheme("hasan-signature"));
    assert.isFalse(isTheme("sepia"));
  });

  it("resolves Hasan Signature to dark consumers", () => {
    assert.equal(resolveTheme("hasan-signature", false), "dark");
    assert.equal(resolveDesktopTheme("hasan-signature"), "dark");
  });

  it("adds a dedicated document class for Hasan Signature only", () => {
    assert.equal(resolveThemeClassName("hasan-signature"), HASAN_SIGNATURE_THEME_CLASS);
    assert.isNull(resolveThemeClassName("dark"));
  });
});
