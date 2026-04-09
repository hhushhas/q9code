import { parsePatchFiles } from "@pierre/diffs";

export interface TurnDiffFileSummary {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export function parseTurnDiffFilesFromUnifiedDiff(
  diff: string,
): ReadonlyArray<TurnDiffFileSummary> {
  const normalized = diff.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [];
  }

  const parsedPatches = parsePatchFiles(normalized);
  const files = parsedPatches.flatMap((patch) =>
    patch.files.map((file) => ({
      path: file.name,
      additions: file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0),
      deletions: file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0),
    })),
  );

  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

export function filterTurnDiffFilesToPaths(
  files: ReadonlyArray<TurnDiffFileSummary>,
  allowedPaths: ReadonlySet<string>,
): ReadonlyArray<TurnDiffFileSummary> {
  if (allowedPaths.size === 0) {
    return [];
  }
  return files.filter((file) => allowedPaths.has(file.path));
}

export function filterUnifiedDiffByPaths(diff: string, allowedPaths: ReadonlySet<string>): string {
  if (allowedPaths.size === 0) {
    return "";
  }

  const normalized = diff.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return "";
  }

  const segments = normalized.split(/(?=^diff --git )/gm);
  const filteredSegments = segments.filter((segment) => {
    const parsedPatches = parsePatchFiles(segment);
    return parsedPatches.some((patch) => patch.files.some((file) => allowedPaths.has(file.name)));
  });

  return filteredSegments.join("\n").trim();
}
