import type { OrchestrationThreadActivity } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export type UsageLimitWindowSnapshot = {
  usedPercentage: number;
  normalizedUsedPercentage: number;
  remainingPercentage: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type UsageLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  primary: UsageLimitWindowSnapshot | null;
  secondary: UsageLimitWindowSnapshot | null;
  activeWindow: UsageLimitWindowSnapshot;
  credits: {
    hasCredits: boolean | null;
    unlimited: boolean | null;
    balance: string | null;
  } | null;
  spendControl: {
    reached: boolean | null;
  } | null;
  updatedAt: string;
};

function normalizeUsageLimitWindow(value: unknown): UsageLimitWindowSnapshot | null {
  const record = asRecord(value);
  const usedPercentage = asFiniteNumber(record?.usedPercent);
  if (usedPercentage === null) {
    return null;
  }

  const normalizedUsedPercentage = Math.max(0, Math.min(100, usedPercentage));
  return {
    usedPercentage,
    normalizedUsedPercentage,
    remainingPercentage: Math.max(0, 100 - normalizedUsedPercentage),
    windowDurationMins: asFiniteNumber(record?.windowDurationMins),
    resetsAt: asFiniteNumber(record?.resetsAt),
  };
}

export function deriveLatestUsageLimitSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): UsageLimitSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "usage-limit.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const primary = normalizeUsageLimitWindow(payload?.primary);
    const secondary = normalizeUsageLimitWindow(payload?.secondary);
    const activeWindow = primary ?? secondary;
    if (!activeWindow) {
      continue;
    }

    const creditsRecord = asRecord(payload?.credits);
    const spendControlRecord = asRecord(payload?.spendControl);

    return {
      limitId: asString(payload?.limitId),
      limitName: asString(payload?.limitName),
      planType: asString(payload?.planType),
      primary,
      secondary,
      activeWindow,
      credits: creditsRecord
        ? {
            hasCredits: asBoolean(creditsRecord.hasCredits),
            unlimited: asBoolean(creditsRecord.unlimited),
            balance: asString(creditsRecord.balance),
          }
        : null,
      spendControl: spendControlRecord
        ? {
            reached: asBoolean(spendControlRecord.reached),
          }
        : null,
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

export function formatUsageLimitPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function formatUsageLimitWindowLabel(
  windowDurationMins: number | null,
  fallback: string,
): string {
  if (
    windowDurationMins === null ||
    !Number.isFinite(windowDurationMins) ||
    windowDurationMins <= 0
  ) {
    return fallback;
  }

  const minutes = Math.round(windowDurationMins);
  if (minutes === 10_080) {
    return "weekly";
  }
  if (minutes % 1_440 === 0) {
    return `${minutes / 1_440}-day`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60}-hour`;
  }
  return `${minutes}-minute`;
}

export function formatUsageLimitResetAt(resetsAt: number | null, now = new Date()): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt)) {
    return null;
  }

  const date = new Date(resetsAt * 1000);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
