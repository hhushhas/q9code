import {
  type CodexModelOptions,
  type ManagerDelegationWorkerModel,
  type ManagerDelegationWorkerModelSelection,
  type ModelCapabilities,
  type ModelSelection,
  type ProviderInteractionMode,
} from "@t3tools/contracts";
import { parseManagerDelegationManifest } from "./managerDependencies";

export const MANAGER_THREAD_TITLE = "Project manager";
export const MANAGER_DEFAULT_NAME_POOL = [
  "Atlas coordinator",
  "Beacon coordinator",
  "Compass coordinator",
  "Harbor coordinator",
  "Northstar coordinator",
  "Signal coordinator",
  "Summit coordinator",
  "Relay coordinator",
  "Anchor coordinator",
  "Forge coordinator",
  "Helm coordinator",
  "Orbit coordinator",
] as const;
export const MANAGER_DELEGATION_TAG = "manager_delegation";
export const MANAGER_DELEGATION_OPEN_TAG = `<${MANAGER_DELEGATION_TAG}>`;
export const MANAGER_DELEGATION_CLOSE_TAG = `</${MANAGER_DELEGATION_TAG}>`;
export const MANAGER_INTERNAL_ALERT_TAG = "manager_internal_alert";
export const MANAGER_INTERNAL_ALERT_OPEN_TAG = `<${MANAGER_INTERNAL_ALERT_TAG}>`;
export const MANAGER_INTERNAL_ALERT_CLOSE_TAG = `</${MANAGER_INTERNAL_ALERT_TAG}>`;
export const WORKER_COMPLETE_TAG = "worker_complete";
export const WORKER_COMPLETE_OPEN_TAG = `<${WORKER_COMPLETE_TAG}>`;
export const WORKER_COMPLETE_CLOSE_TAG = `</${WORKER_COMPLETE_TAG}>`;
export const WORKER_BLOCKED_TAG = "worker_blocked";
export const WORKER_BLOCKED_OPEN_TAG = `<${WORKER_BLOCKED_TAG}>`;
export const WORKER_BLOCKED_CLOSE_TAG = `</${WORKER_BLOCKED_TAG}>`;
export const WORKER_FINAL_TAG = "worker_final";
export const WORKER_FINAL_OPEN_TAG = `<${WORKER_FINAL_TAG}>`;
export const WORKER_FINAL_CLOSE_TAG = `</${WORKER_FINAL_TAG}>`;
export const MANAGER_CHECKLIST_FENCE = "manager-checklist";
export const MANAGER_MODEL_SELECTION = {
  provider: "codex",
  model: "gpt-5.4",
} as const satisfies ModelSelection;
export const MANAGER_WORKER_MODEL_SELECTION = {
  provider: "codex",
  model: "gpt-5.4",
} as const satisfies ModelSelection;
export const MANAGER_INTERACTION_MODE = "default" as const satisfies ProviderInteractionMode;
export const MANAGER_WORKER_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "xhigh", label: "Extra High" },
    { value: "high", label: "High", isDefault: true },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ] satisfies ReadonlyArray<{
    value: NonNullable<CodexModelOptions["reasoningEffort"]>;
    label: string;
    isDefault?: boolean;
  }>,
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};
export const MANAGER_WORKER_MODEL_PRESETS: readonly {
  readonly model: ManagerDelegationWorkerModel;
  readonly label: string;
  readonly summary: string;
  readonly description: string;
  readonly isDefault?: boolean;
}[] = [
  {
    model: "gpt-5.4",
    label: "GPT-5.4",
    summary: "General smartest",
    description: "Default worker for the hardest diagnosis, planning, and implementation tasks.",
    isDefault: true,
  },
  {
    model: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    summary: "Code-smart specialist",
    description: "Best when the work is heavily code-centric and benefits from codex instincts.",
  },
  {
    model: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    summary: "Fast high-volume support",
    description:
      "Use for codebase search, web research, bulk renames, and other cheaper support work.",
  },
] as const;

export function resolveManagerWorkerModelSelection(
  modelSelection?: ManagerDelegationWorkerModelSelection | null,
): ManagerDelegationWorkerModelSelection {
  return modelSelection ?? MANAGER_WORKER_MODEL_SELECTION;
}

const MANAGER_DELEGATION_BLOCK_RE = new RegExp(
  `${MANAGER_DELEGATION_OPEN_TAG}\\s*([\\s\\S]*?)\\s*${MANAGER_DELEGATION_CLOSE_TAG}`,
  "gi",
);
const MANAGER_INTERNAL_ALERT_BLOCK_RE = new RegExp(
  `${MANAGER_INTERNAL_ALERT_OPEN_TAG}\\s*([\\s\\S]*?)\\s*${MANAGER_INTERNAL_ALERT_CLOSE_TAG}`,
  "gi",
);
const WORKER_FINAL_BLOCK_RE = new RegExp(
  `${WORKER_FINAL_OPEN_TAG}\\s*([\\s\\S]*?)\\s*${WORKER_FINAL_CLOSE_TAG}`,
  "gi",
);
const MANAGER_CHECKLIST_BLOCK_RE = new RegExp(
  String.raw`^\`\`\`${MANAGER_CHECKLIST_FENCE}[^\n]*\n([\s\S]*?)^\`\`\`\s*$`,
  "gim",
);
const WORKER_COMPLETE_BLOCK_RE = new RegExp(
  `${WORKER_COMPLETE_OPEN_TAG}\\s*([\\s\\S]*?)\\s*${WORKER_COMPLETE_CLOSE_TAG}`,
  "gi",
);
const WORKER_BLOCKED_BLOCK_RE = new RegExp(
  `${WORKER_BLOCKED_OPEN_TAG}\\s*([\\s\\S]*?)\\s*${WORKER_BLOCKED_CLOSE_TAG}`,
  "gi",
);

const toTrimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toOptionalNullableString = (value: unknown) => {
  if (value === null) {
    return null;
  }
  const normalized = toTrimmedString(value);
  return normalized.length > 0 ? normalized : undefined;
};

function deriveDelegationWorkerId(value: unknown, index: number): string {
  const title = toTrimmedString(value);
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized.length > 0 ? normalized : `worker-${index + 1}`;
}

function normalizeLegacyDelegationManifest(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const workers = Array.isArray(record.workers) ? record.workers : [];

  return {
    ...record,
    workers: workers.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return entry;
      }
      const worker = entry as Record<string, unknown>;
      return {
        ...worker,
        id:
          typeof worker.id === "string" && worker.id.trim().length > 0
            ? worker.id
            : deriveDelegationWorkerId(worker.title, index),
      };
    }),
  };
}

const normalizeInternalAlert = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const kind = toTrimmedString(record.kind);
  const workerTitle = toTrimmedString(record.workerTitle);
  const summary = toTrimmedString(record.summary);
  const createdAt = toTrimmedString(record.createdAt);
  if (
    kind.length === 0 ||
    workerTitle.length === 0 ||
    summary.length === 0 ||
    createdAt.length === 0
  ) {
    return null;
  }

  return {
    kind,
    workerTitle,
    summary,
    createdAt,
    ...(toOptionalNullableString(record.workerThreadId) !== undefined
      ? { workerThreadId: toOptionalNullableString(record.workerThreadId) }
      : {}),
    ...(toOptionalNullableString(record.details) !== undefined
      ? { details: toOptionalNullableString(record.details) }
      : {}),
  };
};

export type ManagerInternalAlert = NonNullable<ReturnType<typeof normalizeInternalAlert>>;
export interface ManagerChecklistItem {
  readonly text: string;
  readonly checked: boolean;
}

export function extractManagerDelegation(text: string) {
  const matches = [...text.matchAll(MANAGER_DELEGATION_BLOCK_RE)];
  const block = matches.at(-1)?.[1];
  if (!block) {
    return null;
  }

  try {
    const parsed = JSON.parse(block) as unknown;
    return parseManagerDelegationManifest(normalizeLegacyDelegationManifest(parsed));
  } catch {
    return null;
  }
}

export type ManagerDelegationManifest = NonNullable<ReturnType<typeof extractManagerDelegation>>;

export function stripManagerDelegation(text: string): string {
  return text
    .replaceAll(MANAGER_DELEGATION_BLOCK_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type WorkerOutcomeKind = "complete" | "blocked";

export type WorkerOutcome = {
  readonly kind: WorkerOutcomeKind;
  readonly content: string;
};

function collectWorkerOutcomes(text: string): Array<{
  readonly kind: WorkerOutcomeKind;
  readonly content: string;
  readonly index: number;
}> {
  const outcomes = [
    ...[...text.matchAll(WORKER_COMPLETE_BLOCK_RE)].map((match) => ({
      kind: "complete" as const,
      content: match[1]?.trim() ?? "",
      index: match.index ?? -1,
    })),
    ...[...text.matchAll(WORKER_BLOCKED_BLOCK_RE)].map((match) => ({
      kind: "blocked" as const,
      content: match[1]?.trim() ?? "",
      index: match.index ?? -1,
    })),
    ...[...text.matchAll(WORKER_FINAL_BLOCK_RE)].map((match) => ({
      kind: "complete" as const,
      content: match[1]?.trim() ?? "",
      index: match.index ?? -1,
    })),
  ].filter((match) => match.content.length > 0);

  outcomes.sort((left, right) => left.index - right.index);
  return outcomes;
}

export function extractWorkerOutcome(text: string): WorkerOutcome | null {
  const lastMatch = collectWorkerOutcomes(text).at(-1);
  if (!lastMatch) {
    return null;
  }

  return {
    kind: lastMatch.kind,
    content: lastMatch.content,
  };
}

export function extractWorkerFinal(text: string): string | null {
  const outcome = extractWorkerOutcome(text);
  return outcome?.kind === "complete" ? outcome.content : null;
}

export function stripWorkerFinal(text: string): string {
  return text
    .replaceAll(WORKER_COMPLETE_BLOCK_RE, (_, content: string) => content.trim())
    .replaceAll(WORKER_BLOCKED_BLOCK_RE, (_, content: string) => content.trim())
    .replaceAll(WORKER_FINAL_BLOCK_RE, (_, content: string) => content.trim())
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripManagerControlMarkup(text: string): string {
  return stripWorkerFinal(stripManagerDelegation(text));
}

export function extractManagerChecklist(text: string): {
  readonly raw: string;
  readonly items: readonly ManagerChecklistItem[];
} | null {
  const matches = [...text.matchAll(MANAGER_CHECKLIST_BLOCK_RE)];
  const block = matches.at(-1)?.[1];
  if (!block) {
    return null;
  }

  const items = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = /^(?:[-*+]|\d+\.)\s+\[(?<mark>[ xX])\]\s+(?<text>.+)$/.exec(line);
      if (!match?.groups?.text || !match.groups.mark) {
        return null;
      }
      const normalizedText = match.groups.text.trim();
      if (normalizedText.length === 0) {
        return null;
      }
      return {
        text: normalizedText,
        checked: match.groups.mark.trim().toLowerCase() === "x",
      } satisfies ManagerChecklistItem;
    })
    .filter((item): item is ManagerChecklistItem => item !== null);

  if (items.length === 0) {
    return null;
  }

  return {
    raw: block.trim(),
    items,
  };
}

export function extractManagerInternalAlert(text: string) {
  const matches = [...text.matchAll(MANAGER_INTERNAL_ALERT_BLOCK_RE)];
  const block = matches.at(-1)?.[1];
  if (!block) {
    return null;
  }

  try {
    const parsed = JSON.parse(block) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const alerts = (Array.isArray(record.alerts) ? record.alerts : [])
      .map((entry) => normalizeInternalAlert(entry))
      .filter((entry): entry is ManagerInternalAlert => entry !== null)
      .slice(0, 16);
    if (alerts.length === 0) {
      return null;
    }

    return {
      alerts,
    };
  } catch {
    return null;
  }
}

export function formatManagerInternalAlert(alerts: readonly ManagerInternalAlert[]): string {
  return [
    MANAGER_INTERNAL_ALERT_OPEN_TAG,
    JSON.stringify({ alerts }),
    MANAGER_INTERNAL_ALERT_CLOSE_TAG,
  ].join("\n");
}

export function isManagerInternalAlert(text: string): boolean {
  return extractManagerInternalAlert(text) !== null;
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function isLegacyManagerThreadTitle(title: string): boolean {
  return title.trim() === MANAGER_THREAD_TITLE;
}

export function pickDefaultManagerThreadTitle(seed: string): string {
  const index = hashSeed(seed) % MANAGER_DEFAULT_NAME_POOL.length;
  return MANAGER_DEFAULT_NAME_POOL[index] ?? MANAGER_THREAD_TITLE;
}

export function resolveManagerThreadTitle(input: {
  readonly requestedTitle: string;
  readonly seed: string;
}): string {
  const requestedTitle = input.requestedTitle.trim();
  if (requestedTitle.length === 0 || isLegacyManagerThreadTitle(requestedTitle)) {
    return pickDefaultManagerThreadTitle(input.seed);
  }
  return requestedTitle;
}
