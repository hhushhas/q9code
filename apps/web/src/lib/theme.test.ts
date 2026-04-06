import { assert, describe, it } from "vitest";

import {
  HASAN_SIGNATURE_THEME_CLASS,
  HASAN_SIGNATURE_LIGHT_THEME_CLASS,
  isTheme,
  resolveDesktopTheme,
  resolveTheme,
  resolveThemeClassName,
} from "./theme";

describe("theme helpers", () => {
  it("accepts Hasan Signature as a valid theme", () => {
    assert.isTrue(isTheme("hasan-signature"));
    assert.isTrue(isTheme("hasan-signature-light"));
    assert.isFalse(isTheme("sepia"));
  });

  it("resolves Hasan Signature variants to the correct binary consumers", () => {
    assert.equal(resolveTheme("hasan-signature", false), "dark");
    assert.equal(resolveDesktopTheme("hasan-signature"), "dark");
    assert.equal(resolveTheme("hasan-signature-light", true), "light");
    assert.equal(resolveDesktopTheme("hasan-signature-light"), "light");
  });

  it("adds dedicated document classes for Hasan Signature variants only", () => {
    assert.equal(resolveThemeClassName("hasan-signature"), HASAN_SIGNATURE_THEME_CLASS);
    assert.equal(resolveThemeClassName("hasan-signature-light"), HASAN_SIGNATURE_LIGHT_THEME_CLASS);
    assert.isNull(resolveThemeClassName("dark"));
  });
});
