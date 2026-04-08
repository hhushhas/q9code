import type { ModelSelection, ProviderInteractionMode } from "@t3tools/contracts";

export const MANAGER_THREAD_TITLE = "Project manager";
export const MANAGER_DELEGATION_TAG = "manager_delegation";
export const MANAGER_DELEGATION_OPEN_TAG = `<${MANAGER_DELEGATION_TAG}>`;
export const MANAGER_DELEGATION_CLOSE_TAG = `</${MANAGER_DELEGATION_TAG}>`;
export const MANAGER_MODEL_SELECTION = {
  provider: "codex",
  model: "gpt-5.4",
} as const satisfies ModelSelection;
export const MANAGER_WORKER_MODEL_SELECTION = {
  provider: "codex",
  model: "gpt-5-codex",
} as const satisfies ModelSelection;
export const MANAGER_INTERACTION_MODE = "default" as const satisfies ProviderInteractionMode;

const MANAGER_DELEGATION_BLOCK_RE = new RegExp(
  `${MANAGER_DELEGATION_OPEN_TAG}\\s*([\\s\\S]*?)\\s*${MANAGER_DELEGATION_CLOSE_TAG}`,
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

const normalizeDelegationWorker = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = toTrimmedString(record.title);
  const prompt = toTrimmedString(record.prompt);
  if (title.length === 0 || prompt.length === 0) {
    return null;
  }

  return {
    title,
    prompt,
    ...(toOptionalNullableString(record.branch) !== undefined
      ? { branch: toOptionalNullableString(record.branch) }
      : {}),
    ...(toOptionalNullableString(record.worktreePath) !== undefined
      ? { worktreePath: toOptionalNullableString(record.worktreePath) }
      : {}),
  };
};

export type ManagerDelegationWorker = NonNullable<ReturnType<typeof normalizeDelegationWorker>>;

export function extractManagerDelegation(text: string) {
  const matches = [...text.matchAll(MANAGER_DELEGATION_BLOCK_RE)];
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
    const workers = (Array.isArray(record.workers) ? record.workers : [])
      .map((entry) => normalizeDelegationWorker(entry))
      .filter((entry): entry is ManagerDelegationWorker => entry !== null)
      .slice(0, 8);
    if (workers.length === 0) {
      return null;
    }

    const summary = toTrimmedString(record.summary);
    return {
      summary: summary.length > 0 ? summary : null,
      workers,
    };
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
