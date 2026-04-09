import type { TurnId } from "@t3tools/contracts";

type ThreadActivityLike = {
  readonly turnId: TurnId | null;
  readonly payload?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

export function extractChangedFiles(value: unknown): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();
  collectChangedFiles(value, changedFiles, seen, 0);
  return changedFiles;
}

export function extractChangedFilesFromActivities(
  activities: ReadonlyArray<ThreadActivityLike>,
  turnId: TurnId,
): string[] {
  const changedFiles: string[] = [];
  const seen = new Set<string>();

  for (const activity of activities) {
    if (activity.turnId !== turnId) {
      continue;
    }
    const payload = asRecord(activity.payload);
    const files = extractChangedFiles(asRecord(payload?.data));
    for (const filePath of files) {
      if (seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      changedFiles.push(filePath);
      if (changedFiles.length >= 12) {
        return changedFiles;
      }
    }
  }

  return changedFiles;
}
