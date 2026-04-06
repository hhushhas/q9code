import type { DesktopTheme } from "@t3tools/contracts";

export const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
  },
  {
    value: "light",
    label: "Light",
  },
  {
    value: "dark",
    label: "Dark",
  },
  {
    value: "hasan-signature",
    label: "Hasan Signature",
  },
  {
    value: "hasan-signature-light",
    label: "Hasan Signature Light",
  },
] as const;

export type Theme = (typeof THEME_OPTIONS)[number]["value"];
export const HASAN_SIGNATURE_THEME_CLASS = "theme-hasan-signature";
export const HASAN_SIGNATURE_LIGHT_THEME_CLASS = "theme-hasan-signature-light";
export const THEME_CLASS_NAMES = [
  HASAN_SIGNATURE_THEME_CLASS,
  HASAN_SIGNATURE_LIGHT_THEME_CLASS,
] as const;

const THEME_VALUES = new Set<Theme>(THEME_OPTIONS.map((option) => option.value));

export const DESKTOP_THEME_BY_THEME = {
  system: "system",
  light: "light",
  dark: "dark",
  "hasan-signature": "dark",
  "hasan-signature-light": "light",
} as const satisfies Record<Theme, DesktopTheme>;

export function isTheme(value: string | null | undefined): value is Theme {
  return value !== undefined && value !== null && THEME_VALUES.has(value as Theme);
}

export function resolveTheme(theme: Theme, systemDark: boolean): "light" | "dark" {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme === "light" || theme === "hasan-signature-light" ? "light" : "dark";
}

export function resolveDesktopTheme(theme: Theme): DesktopTheme {
  return DESKTOP_THEME_BY_THEME[theme];
}

export function resolveThemeClassName(theme: Theme): string | null {
  if (theme === "hasan-signature") return HASAN_SIGNATURE_THEME_CLASS;
  if (theme === "hasan-signature-light") return HASAN_SIGNATURE_LIGHT_THEME_CLASS;
  return null;
}
