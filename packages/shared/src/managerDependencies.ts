import type {
  ManagerDelegationManifest,
  ManagerDelegationWorker,
  ManagerDelegationWorkerId,
  ManagerDelegationWorkerKind,
  ManagerDelegationWorkerSnapshot,
  ManagerDelegationWorkerState,
  ThreadId,
} from "@t3tools/contracts";
import { ManagerDelegationManifest as ManagerDelegationManifestSchema } from "@t3tools/contracts";
import { Schema } from "effect";

const decodeManagerDelegationManifest = Schema.decodeUnknownSync(ManagerDelegationManifestSchema);

export interface ManagerDelegationIssue {
  readonly code:
    | "duplicate_worker_id"
    | "unknown_dependency"
    | "self_dependency"
    | "dependency_cycle"
    | "gate_sensitive_requires_dependency";
  readonly workerId: ManagerDelegationWorkerId;
  readonly detail: string;
}

export interface ManagerDelegationRuntimeState {
  readonly threadId?: ThreadId | null;
  readonly state?: Extract<
    ManagerDelegationWorkerState,
    "running" | "blocked" | "completed" | "failed"
  >;
}

export const MANAGER_GATE_SENSITIVE_WORKER_KINDS = [
  "review",
  "release",
] as const satisfies readonly ManagerDelegationWorkerKind[];

function isGateSensitiveWorkerKind(kind: ManagerDelegationWorkerKind): boolean {
  return kind === "review" || kind === "release";
}

export function parseManagerDelegationManifest(value: unknown): ManagerDelegationManifest | null {
  try {
    return decodeManagerDelegationManifest(value);
  } catch {
    return null;
  }
}

export function collectManagerDelegationIssues(
  manifest: ManagerDelegationManifest,
): readonly ManagerDelegationIssue[] {
  const issues: ManagerDelegationIssue[] = [];
  const workersById = new Map<ManagerDelegationWorkerId, ManagerDelegationWorker>();

  for (const worker of manifest.workers) {
    if (workersById.has(worker.id)) {
      issues.push({
        code: "duplicate_worker_id",
        workerId: worker.id,
        detail: `Worker id '${worker.id}' is declared more than once.`,
      });
      continue;
    }
    workersById.set(worker.id, worker);
  }

  for (const worker of manifest.workers) {
    if (isGateSensitiveWorkerKind(worker.kind) && worker.dependsOn.length === 0) {
      issues.push({
        code: "gate_sensitive_requires_dependency",
        workerId: worker.id,
        detail: `Gate-sensitive worker '${worker.id}' (${worker.kind}) must declare at least one dependency.`,
      });
    }

    for (const dependencyId of worker.dependsOn) {
      if (dependencyId === worker.id) {
        issues.push({
          code: "self_dependency",
          workerId: worker.id,
          detail: `Worker '${worker.id}' cannot depend on itself.`,
        });
        continue;
      }
      if (!workersById.has(dependencyId)) {
        issues.push({
          code: "unknown_dependency",
          workerId: worker.id,
          detail: `Worker '${worker.id}' depends on unknown worker '${dependencyId}'.`,
        });
      }
    }
  }

  const visited = new Set<ManagerDelegationWorkerId>();
  const stack = new Set<ManagerDelegationWorkerId>();
  const cycleWorkers = new Set<ManagerDelegationWorkerId>();

  const visit = (workerId: ManagerDelegationWorkerId) => {
    if (stack.has(workerId)) {
      cycleWorkers.add(workerId);
      return;
    }
    if (visited.has(workerId)) {
      return;
    }
    visited.add(workerId);
    stack.add(workerId);

    const worker = workersById.get(workerId);
    if (!worker) {
      stack.delete(workerId);
      return;
    }

    for (const dependencyId of worker.dependsOn) {
      if (workersById.has(dependencyId)) {
        visit(dependencyId);
        if (cycleWorkers.has(dependencyId)) {
          cycleWorkers.add(workerId);
        }
      }
    }

    stack.delete(workerId);
  };

  for (const worker of manifest.workers) {
    visit(worker.id);
  }

  for (const workerId of cycleWorkers) {
    issues.push({
      code: "dependency_cycle",
      workerId,
      detail: `Worker '${workerId}' is part of a dependency cycle.`,
    });
  }

  return issues;
}

export function buildInitialManagerDelegationSnapshots(
  manifest: ManagerDelegationManifest,
): readonly ManagerDelegationWorkerSnapshot[] {
  const blockingIssues = new Set(
    collectManagerDelegationIssues(manifest).map((issue) => issue.workerId),
  );

  return manifest.workers.map((worker) => ({
    workerId: worker.id,
    threadId: null,
    state: blockingIssues.has(worker.id) ? "blocked" : "planned",
    blockingWorkerIds: [],
  }));
}

export function resolveManagerDelegationSnapshots(input: {
  readonly manifest: ManagerDelegationManifest;
  readonly runtimeStates?: Readonly<Record<string, ManagerDelegationRuntimeState | undefined>>;
}): readonly ManagerDelegationWorkerSnapshot[] {
  const runtimeStates = input.runtimeStates ?? {};
  const issues = collectManagerDelegationIssues(input.manifest);
  const blockingWorkers = new Map<ManagerDelegationWorkerId, readonly ManagerDelegationIssue[]>();
  for (const issue of issues) {
    const existing = blockingWorkers.get(issue.workerId) ?? [];
    blockingWorkers.set(issue.workerId, [...existing, issue]);
  }

  const completedWorkers = new Set<ManagerDelegationWorkerId>();
  for (const worker of input.manifest.workers) {
    if (runtimeStates[worker.id]?.state === "completed") {
      completedWorkers.add(worker.id);
    }
  }

  return input.manifest.workers.map((worker) => {
    const runtime = runtimeStates[worker.id];
    const issueList = blockingWorkers.get(worker.id) ?? [];

    if (runtime?.state === "completed") {
      return {
        workerId: worker.id,
        threadId: runtime.threadId ?? null,
        state: "completed",
        blockingWorkerIds: [],
      };
    }
    if (runtime?.state === "failed") {
      return {
        workerId: worker.id,
        threadId: runtime.threadId ?? null,
        state: "failed",
        blockingWorkerIds: [],
      };
    }
    if (runtime?.state === "running") {
      return {
        workerId: worker.id,
        threadId: runtime.threadId ?? null,
        state: "running",
        blockingWorkerIds: [],
      };
    }
    if (runtime?.state === "blocked" || issueList.length > 0) {
      return {
        workerId: worker.id,
        threadId: runtime?.threadId ?? null,
        state: "blocked",
        blockingWorkerIds: worker.dependsOn.filter(
          (dependencyId) => !completedWorkers.has(dependencyId),
        ),
      };
    }

    const unresolvedDependencies = worker.dependsOn.filter(
      (dependencyId) => !completedWorkers.has(dependencyId),
    );

    if (unresolvedDependencies.length > 0) {
      return {
        workerId: worker.id,
        threadId: runtime?.threadId ?? null,
        state: "waiting_on_dependencies",
        blockingWorkerIds: unresolvedDependencies,
      };
    }

    return {
      workerId: worker.id,
      threadId: runtime?.threadId ?? null,
      state: "ready",
      blockingWorkerIds: [],
    };
  });
}
