import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThreadManagerScratchpad,
  ThreadId,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { resolveManagerDelegationSnapshots } from "@t3tools/shared/managerDependencies";
import {
  extractWorkerOutcome,
  extractManagerDelegation,
  extractManagerInternalAlert,
  formatManagerInternalAlert,
  MANAGER_INTERACTION_MODE,
  MANAGER_MODEL_SELECTION,
  resolveManagerWorkerModelSelection,
  type ManagerInternalAlert,
  stripManagerControlMarkup,
} from "@t3tools/shared/manager";
import { Effect, FileSystem, Layer, Path, Stream } from "effect";

import {
  ManagerThreadReactor,
  type ManagerThreadReactorShape,
} from "../Services/ManagerThreadReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { buildWorkerScratchpadLogPath } from "../managerScratchpad.ts";

type RelevantEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.created"
      | "thread.meta-updated"
      | "manager.worker-input-requested"
      | "thread.turn-start-requested"
      | "thread.message-sent"
      | "thread.turn-diff-completed"
      | "thread.activity-appended"
      | "thread.session-set";
  }
>;

type ThreadContext = {
  readonly readModel: OrchestrationReadModel;
  readonly thread: OrchestrationThread;
  readonly managerThread: OrchestrationThread;
  readonly projectTitle: string;
};

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

const truncateText = (value: string, maxChars: number) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
};

const asLogSection = (timestamp: string, lines: readonly string[]) =>
  [`## ${timestamp}`, ...lines.map((line) => `- ${line}`), ""].join("\n");

const buildManagerLogHeader = (input: {
  readonly projectTitle: string;
  readonly managerThread: OrchestrationThread;
  readonly sessionLogPath: string;
}) =>
  [
    `# ${input.projectTitle} manager session log`,
    "",
    `Manager thread: ${input.managerThread.title} (${input.managerThread.id})`,
    `Manager folder: ${input.managerThread.managerScratchpad?.folderPath ?? "n/a"}`,
    `Session log: ${input.sessionLogPath}`,
    "",
  ].join("\n");

const splitLogBody = (existing: string) => {
  const sectionIndex = existing.search(/^## /m);
  if (sectionIndex === -1) {
    return "";
  }
  return existing.slice(sectionIndex).replace(/^\n+/, "");
};

type DelegationManifest = NonNullable<ReturnType<typeof extractManagerDelegation>>;
type DelegationWorker = DelegationManifest["workers"][number];
type ManagerWorkerMetadata = {
  readonly workerId: string;
  readonly workerTitle: string;
  readonly prompt?: string | undefined;
  readonly dependsOn?: readonly string[] | undefined;
  readonly kind?: string | undefined;
  readonly modelSelection?: OrchestrationThread["modelSelection"] | undefined;
  readonly branch?: string | null | undefined;
  readonly worktreePath?: string | null | undefined;
};

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseManagerWorkerMetadata(value: unknown): ManagerWorkerMetadata | null {
  const payload = asObjectRecord(value);
  if (!payload) {
    return null;
  }
  if (typeof payload.workerId !== "string" || typeof payload.workerTitle !== "string") {
    return null;
  }

  const dependsOn = Array.isArray(payload.dependsOn)
    ? payload.dependsOn.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  return {
    workerId: payload.workerId,
    workerTitle: payload.workerTitle,
    ...(typeof payload.prompt === "string" ? { prompt: payload.prompt } : {}),
    ...(dependsOn !== undefined ? { dependsOn } : {}),
    ...(typeof payload.kind === "string" ? { kind: payload.kind } : {}),
    ...(payload.modelSelection && typeof payload.modelSelection === "object"
      ? { modelSelection: payload.modelSelection as OrchestrationThread["modelSelection"] }
      : {}),
    ...(typeof payload.branch === "string" || payload.branch === null
      ? { branch: payload.branch }
      : {}),
    ...(typeof payload.worktreePath === "string" || payload.worktreePath === null
      ? { worktreePath: payload.worktreePath }
      : {}),
  };
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const handledManagerMessageIds = new Set<string>();
  const pendingManagerAlerts = new Map<ThreadId, ManagerInternalAlert[]>();
  const managerAlertDispatchInFlight = new Set<ThreadId>();

  const resolveThreadContext = Effect.fn("resolveThreadContext")(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId) ?? null;
    if (!thread || thread.deletedAt !== null) {
      return null;
    }

    const managerThread =
      thread.role === "manager"
        ? thread
        : thread.managerThreadId
          ? (readModel.threads.find((entry) => entry.id === thread.managerThreadId) ?? null)
          : null;
    if (!managerThread?.managerScratchpad || managerThread.deletedAt !== null) {
      return null;
    }

    const projectTitle =
      readModel.projects.find((project) => project.id === managerThread.projectId)?.title ??
      "Project";

    return {
      readModel,
      thread,
      managerThread,
      projectTitle,
    } satisfies ThreadContext;
  });

  const resolveThreadContextEventually = Effect.fn("resolveThreadContextEventually")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly attempts?: number;
      readonly predicate?: (context: ThreadContext) => boolean;
    }) {
      const attempts = input.attempts ?? 20;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const context = yield* resolveThreadContext(input.threadId);
        if (context && (!input.predicate || input.predicate(context))) {
          return context;
        }
        if (attempt < attempts - 1) {
          yield* Effect.sleep("10 millis");
        }
      }

      return yield* resolveThreadContext(input.threadId);
    },
  );

  const appendToManagerLog = Effect.fn("appendToManagerLog")(function* (input: {
    readonly threadId: ThreadId;
    readonly createdAt: string;
    readonly lines: readonly string[];
  }) {
    const context = yield* resolveThreadContext(input.threadId);
    if (!context) {
      return;
    }

    const sessionLogPath = context.managerThread.managerScratchpad?.sessionLogPath;
    if (!sessionLogPath) {
      return;
    }

    yield* fileSystem.makeDirectory(path.dirname(sessionLogPath), { recursive: true });
    const existing = yield* fileSystem
      .readFileString(sessionLogPath)
      .pipe(Effect.orElseSucceed(() => ""));
    const nextContents = [
      buildManagerLogHeader({
        projectTitle: context.projectTitle,
        managerThread: context.managerThread,
        sessionLogPath,
      }).trimEnd(),
      "",
      splitLogBody(existing).trimStart(),
      asLogSection(input.createdAt, input.lines).trimStart(),
    ]
      .filter((section) => section.length > 0)
      .join("\n");

    yield* fileSystem.writeFileString(sessionLogPath, `${nextContents}\n`);
  });

  const appendToWorkerLog = Effect.fn("appendToWorkerLog")(function* (input: {
    readonly threadId: ThreadId;
    readonly createdAt: string;
    readonly lines: readonly string[];
  }) {
    const context = yield* resolveThreadContext(input.threadId);
    if (!context || context.thread.role === "manager") {
      return;
    }

    const managerFolderPath = context.managerThread.managerScratchpad?.folderPath;
    if (!managerFolderPath) {
      return;
    }

    const workerLogPath = buildWorkerScratchpadLogPath({
      managerFolderPath,
      workerThreadId: context.thread.id,
    });
    yield* fileSystem.makeDirectory(path.dirname(workerLogPath), { recursive: true });
    const existing = yield* fileSystem
      .readFileString(workerLogPath)
      .pipe(Effect.orElseSucceed(() => ""));
    const header =
      existing.trim().length > 0
        ? existing
        : [
            `# ${context.thread.title} worker log`,
            "",
            `Worker thread: ${context.thread.title} (${context.thread.id})`,
            `Manager thread: ${context.managerThread.title} (${context.managerThread.id})`,
            `Worker log: ${workerLogPath}`,
            "",
          ].join("\n");
    const separator = header.endsWith("\n") ? "" : "\n";
    yield* fileSystem.writeFileString(
      workerLogPath,
      `${header}${separator}${asLogSection(input.createdAt, input.lines)}`,
    );
  });

  const appendManagerActivity = Effect.fn("appendManagerActivity")(function* (input: {
    readonly managerThreadId: ThreadId;
    readonly kind: string;
    readonly summary: string;
    readonly payload: Record<string, unknown>;
    readonly createdAt: string;
    readonly tone?: "info" | "error";
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("manager-thread-activity"),
      threadId: input.managerThreadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: input.tone ?? "info",
        kind: input.kind,
        summary: input.summary,
        payload: input.payload,
        turnId: null,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const findWorkerMetadataByThreadId = (
    managerThread: OrchestrationThread,
    workerThreadId: ThreadId,
  ): ManagerWorkerMetadata | null => {
    for (const activity of [...managerThread.activities].toReversed()) {
      const payload = asObjectRecord(activity.payload);
      if (payload?.workerThreadId !== workerThreadId) {
        continue;
      }
      const metadata = parseManagerWorkerMetadata(payload);
      if (metadata) {
        return metadata;
      }
    }
    return null;
  };

  function launchWorkerThread(input: {
    readonly managerThread: OrchestrationThread;
    readonly worker: DelegationWorker;
    readonly createdAt: string;
    readonly launchKind: "initial" | "auto";
    readonly triggeringWorkerIds?: readonly string[];
  }) {
    return Effect.gen(function* () {
      const workerThreadId = ThreadId.makeUnsafe(crypto.randomUUID());
      const workerModelSelection = resolveManagerWorkerModelSelection(input.worker.modelSelection);
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: serverCommandId("manager-worker-create"),
        threadId: workerThreadId,
        projectId: input.managerThread.projectId,
        title: input.worker.title,
        modelSelection: workerModelSelection,
        role: "worker",
        managerThreadId: input.managerThread.id,
        runtimeMode: input.managerThread.runtimeMode,
        interactionMode: "default",
        branch:
          input.worker.branch === undefined ? input.managerThread.branch : input.worker.branch,
        worktreePath:
          input.worker.worktreePath === undefined
            ? input.managerThread.worktreePath
            : input.worker.worktreePath,
        createdAt: input.createdAt,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: serverCommandId("manager-worker-turn-start"),
        threadId: workerThreadId,
        message: {
          messageId: MessageId.makeUnsafe(crypto.randomUUID()),
          role: "user",
          text: input.worker.prompt,
          attachments: [],
        },
        modelSelection: workerModelSelection,
        titleSeed: input.worker.title,
        runtimeMode: input.managerThread.runtimeMode,
        interactionMode: "default",
        createdAt: input.createdAt,
      });

      const payload = {
        workerId: input.worker.id,
        workerThreadId,
        workerTitle: input.worker.title,
        prompt: input.worker.prompt,
        task: truncateText(input.worker.prompt, 220),
        kind: input.worker.kind,
        dependsOn: input.worker.dependsOn,
        modelSelection: workerModelSelection,
        ...(input.worker.branch !== undefined ? { branch: input.worker.branch } : {}),
        ...(input.worker.worktreePath !== undefined
          ? { worktreePath: input.worker.worktreePath }
          : {}),
        ...(input.triggeringWorkerIds && input.triggeringWorkerIds.length > 0
          ? { triggeringWorkerIds: input.triggeringWorkerIds }
          : {}),
      } satisfies Record<string, unknown>;

      yield* appendManagerActivity({
        managerThreadId: input.managerThread.id,
        kind:
          input.launchKind === "initial"
            ? "manager.worker.launched"
            : "manager.worker.auto-started",
        summary:
          input.launchKind === "initial"
            ? `Launched worker "${input.worker.title}"`
            : `Auto-started worker "${input.worker.title}" after dependencies cleared`,
        payload,
        createdAt: input.createdAt,
      });
    });
  }

  function maybeLaunchDependencyReadyWorkers(input: {
    readonly managerThreadId: ThreadId;
    readonly createdAt: string;
  }) {
    return Effect.gen(function* () {
      const context = yield* resolveThreadContext(input.managerThreadId);
      if (!context || context.thread.role !== "manager") {
        return;
      }

      const waitingDefinitions = new Map<string, DelegationWorker>();
      const startedWorkerIds = new Set<string>();
      const completedWorkerIds = new Set<string>();

      for (const activity of context.thread.activities) {
        const metadata = parseManagerWorkerMetadata(activity.payload);
        if (!metadata) {
          continue;
        }
        if (activity.kind === "manager.worker.waiting-on-dependencies" && metadata.prompt) {
          waitingDefinitions.set(metadata.workerId, {
            id: metadata.workerId as DelegationWorker["id"],
            title: metadata.workerTitle,
            prompt: metadata.prompt,
            kind:
              metadata.kind === "review" || metadata.kind === "release" ? metadata.kind : "general",
            dependsOn: [...(metadata.dependsOn ?? [])] as DelegationWorker["dependsOn"],
            ...(metadata.branch !== undefined ? { branch: metadata.branch } : {}),
            ...(metadata.worktreePath !== undefined ? { worktreePath: metadata.worktreePath } : {}),
          });
        }
        if (
          activity.kind === "manager.worker.launched" ||
          activity.kind === "manager.worker.auto-started"
        ) {
          startedWorkerIds.add(metadata.workerId);
        }
        if (activity.kind === "manager.worker.completed") {
          completedWorkerIds.add(metadata.workerId);
        }
      }

      for (const [workerId, worker] of waitingDefinitions) {
        if (startedWorkerIds.has(workerId)) {
          continue;
        }
        const unresolvedDependencies = worker.dependsOn.filter(
          (dependencyId) => !completedWorkerIds.has(dependencyId),
        );
        if (unresolvedDependencies.length > 0) {
          continue;
        }
        yield* launchWorkerThread({
          managerThread: context.thread,
          worker,
          createdAt: input.createdAt,
          launchKind: "auto",
          triggeringWorkerIds: worker.dependsOn,
        });
      }
    });
  }

  const moveManagerScratchpad = Effect.fn("moveManagerScratchpad")(function* (input: {
    readonly previousScratchpad: OrchestrationThreadManagerScratchpad | null | undefined;
    readonly nextScratchpad: OrchestrationThreadManagerScratchpad | null | undefined;
  }) {
    const previousFolderPath = input.previousScratchpad?.folderPath?.trim();
    const nextFolderPath = input.nextScratchpad?.folderPath?.trim();
    if (
      !previousFolderPath ||
      !nextFolderPath ||
      previousFolderPath === nextFolderPath ||
      !(yield* fileSystem.exists(previousFolderPath))
    ) {
      return;
    }

    yield* fileSystem.makeDirectory(path.dirname(nextFolderPath), { recursive: true });
    if (yield* fileSystem.exists(nextFolderPath)) {
      return;
    }
    yield* fileSystem.rename(previousFolderPath, nextFolderPath);
  });

  const queueManagerAlert = (input: {
    readonly managerThreadId: ThreadId;
    readonly alert: ManagerInternalAlert;
  }) =>
    Effect.sync(() => {
      const existing = pendingManagerAlerts.get(input.managerThreadId) ?? [];
      pendingManagerAlerts.set(input.managerThreadId, [...existing, input.alert].slice(-16));
    });

  const clearManagerAlertDispatch = (managerThreadId: ThreadId) => {
    managerAlertDispatchInFlight.delete(managerThreadId);
  };

  const canWakeManager = (thread: OrchestrationThread) => {
    if (thread.deletedAt !== null) {
      return false;
    }
    if (managerAlertDispatchInFlight.has(thread.id)) {
      return false;
    }
    if (
      thread.session &&
      (thread.session.status === "running" || thread.session.status === "starting")
    ) {
      return false;
    }
    if (thread.session) {
      return thread.session.activeTurnId === null;
    }
    return thread.latestTurn?.completedAt !== null || thread.latestTurn === null;
  };

  const flushManagerAlerts = Effect.fn("flushManagerAlerts")(function* (managerThreadId: ThreadId) {
    const alerts = pendingManagerAlerts.get(managerThreadId);
    if (!alerts || alerts.length === 0) {
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const managerThread = readModel.threads.find((thread) => thread.id === managerThreadId) ?? null;
    if (!managerThread || !canWakeManager(managerThread)) {
      return;
    }

    managerAlertDispatchInFlight.add(managerThreadId);
    pendingManagerAlerts.delete(managerThreadId);
    const messageId = MessageId.makeUnsafe(crypto.randomUUID());

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: serverCommandId("manager-alert-turn-start"),
      threadId: managerThread.id,
      message: {
        messageId,
        role: "user",
        text: formatManagerInternalAlert(alerts),
        attachments: [],
      },
      modelSelection: MANAGER_MODEL_SELECTION,
      titleSeed: managerThread.title,
      runtimeMode: managerThread.runtimeMode,
      interactionMode: MANAGER_INTERACTION_MODE,
      createdAt: alerts.at(-1)?.createdAt ?? new Date().toISOString(),
    });
    yield* resolveThreadContextEventually({
      threadId: managerThread.id,
      predicate: (context) =>
        context.thread.messages.some(
          (message) => message.id === messageId && message.role === "user",
        ),
    });
  });

  const queueAndFlushManagerAlert = Effect.fn("queueAndFlushManagerAlert")(function* (input: {
    readonly managerThreadId: ThreadId;
    readonly alert: ManagerInternalAlert;
  }) {
    yield* queueManagerAlert(input);
    yield* flushManagerAlerts(input.managerThreadId);
  });

  function launchDelegatedWorkers(input: {
    readonly managerThread: OrchestrationThread;
    readonly manifest: DelegationManifest;
    readonly createdAt: string;
  }) {
    return Effect.gen(function* () {
      const snapshots = resolveManagerDelegationSnapshots({
        manifest: input.manifest,
      });

      for (const worker of input.manifest.workers) {
        const snapshot = snapshots.find((entry) => entry.workerId === worker.id);
        if (snapshot?.state === "ready") {
          yield* launchWorkerThread({
            managerThread: input.managerThread,
            worker,
            createdAt: input.createdAt,
            launchKind: "initial",
          });
          continue;
        }

        if (snapshot?.state === "waiting_on_dependencies") {
          yield* appendManagerActivity({
            managerThreadId: input.managerThread.id,
            kind: "manager.worker.waiting-on-dependencies",
            summary: `Worker "${worker.title}" is waiting on dependencies`,
            payload: {
              workerId: worker.id,
              workerTitle: worker.title,
              prompt: worker.prompt,
              task: truncateText(worker.prompt, 220),
              kind: worker.kind,
              dependsOn: worker.dependsOn,
              blockingWorkerIds: snapshot.blockingWorkerIds,
              ...(worker.branch !== undefined ? { branch: worker.branch } : {}),
              ...(worker.worktreePath !== undefined ? { worktreePath: worker.worktreePath } : {}),
            },
            createdAt: input.createdAt,
          });
          continue;
        }

        if (snapshot?.state === "blocked") {
          yield* appendManagerActivity({
            managerThreadId: input.managerThread.id,
            kind: "manager.worker.failed",
            summary: `Worker "${worker.title}" could not be launched`,
            payload: {
              workerId: worker.id,
              workerTitle: worker.title,
              prompt: worker.prompt,
              dependsOn: worker.dependsOn,
              reason:
                worker.dependsOn.length > 0
                  ? `Dependency declaration for "${worker.title}" is invalid.`
                  : `Worker "${worker.title}" could not be scheduled from the delegation manifest.`,
            },
            createdAt: input.createdAt,
            tone: "error",
          });
        }
      }
    });
  }

  function processManagerWorkerInputRequested(
    event: Extract<RelevantEvent, { type: "manager.worker-input-requested" }>,
  ) {
    return Effect.gen(function* () {
      const managerContext = yield* resolveThreadContextEventually({
        threadId: event.payload.managerThreadId,
        predicate: (context) => {
          if (context.thread.role !== "manager") {
            return false;
          }
          const workerThread = context.readModel.threads.find(
            (thread) =>
              thread.id === event.payload.workerThreadId &&
              thread.managerThreadId === context.thread.id &&
              thread.deletedAt === null,
          );
          if (!workerThread) {
            return false;
          }
          if (event.payload.mode !== "interrupt") {
            return true;
          }
          return (
            workerThread.session?.status === "running" ||
            workerThread.session?.activeTurnId !== null ||
            (workerThread.latestTurn !== null && workerThread.latestTurn.completedAt === null)
          );
        },
      });
      if (!managerContext || managerContext.thread.role !== "manager") {
        return;
      }

      const workerThread =
        managerContext.readModel.threads.find(
          (thread) =>
            thread.id === event.payload.workerThreadId &&
            thread.managerThreadId === managerContext.thread.id &&
            thread.deletedAt === null,
        ) ?? null;
      if (!workerThread) {
        return;
      }
      const workerMetadata = findWorkerMetadataByThreadId(managerContext.thread, workerThread.id);

      const workerIsRunning =
        workerThread.session?.status === "running" ||
        (workerThread.latestTurn !== null && workerThread.latestTurn.completedAt === null);
      const shouldInterrupt = event.payload.mode === "interrupt" && workerIsRunning;

      if (shouldInterrupt) {
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.interrupt",
          commandId: serverCommandId("manager-worker-turn-interrupt"),
          threadId: workerThread.id,
          ...(workerThread.session?.activeTurnId !== null &&
          workerThread.session?.activeTurnId !== undefined
            ? { turnId: workerThread.session.activeTurnId }
            : {}),
          createdAt: event.payload.createdAt,
        });
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: serverCommandId("manager-worker-turn-start"),
        threadId: workerThread.id,
        message: {
          messageId: event.payload.messageId,
          role: "user",
          text: event.payload.text,
          attachments: event.payload.attachments,
        },
        modelSelection: workerThread.modelSelection,
        titleSeed: workerThread.title,
        runtimeMode: workerThread.runtimeMode,
        interactionMode: workerThread.interactionMode,
        createdAt: event.payload.createdAt,
      });

      yield* appendManagerActivity({
        managerThreadId: managerContext.thread.id,
        kind: "manager.worker.input.sent",
        summary: `Sent ${shouldInterrupt ? "interrupting" : "queued"} input to "${workerThread.title}"`,
        payload: {
          ...(workerMetadata ? { workerId: workerMetadata.workerId } : {}),
          workerThreadId: workerThread.id,
          workerTitle: workerThread.title,
          requestedMode: event.payload.mode,
          effectiveMode: shouldInterrupt ? "interrupt" : "queue",
          text: truncateText(event.payload.text, 280),
        },
        createdAt: event.payload.createdAt,
      });
      yield* appendManagerActivity({
        managerThreadId: managerContext.thread.id,
        kind: "manager.worker.input.mode",
        summary: shouldInterrupt
          ? `Interrupted "${workerThread.title}" before sending follow-up input`
          : event.payload.mode === "interrupt"
            ? `Queued follow-up input for "${workerThread.title}" because interrupt was unavailable`
            : `Queued follow-up input for "${workerThread.title}"`,
        payload: {
          ...(workerMetadata ? { workerId: workerMetadata.workerId } : {}),
          workerThreadId: workerThread.id,
          workerTitle: workerThread.title,
          requestedMode: event.payload.mode,
          effectiveMode: shouldInterrupt ? "interrupt" : "queue",
        },
        createdAt: event.payload.createdAt,
      });
      yield* appendToManagerLog({
        threadId: managerContext.thread.id,
        createdAt: event.payload.createdAt,
        lines: [
          `Manager sent input to worker "${workerThread.title}" (${workerThread.id})`,
          `Mode: ${event.payload.mode}${shouldInterrupt ? "" : event.payload.mode === "interrupt" ? " (fell back to queue)" : ""}`,
          `Input: ${truncateText(event.payload.text, 600)}`,
        ],
      });
    });
  }

  function processEvent(event: RelevantEvent) {
    return Effect.gen(function* () {
      switch (event.type) {
        case "thread.created": {
          const context = yield* resolveThreadContext(event.payload.threadId);
          if (!context) {
            return;
          }

          if (context.thread.role === "manager") {
            yield* appendToManagerLog({
              threadId: context.thread.id,
              createdAt: event.payload.createdAt,
              lines: [
                `Manager thread created for "${context.projectTitle}".`,
                `Sacred folder: ${context.thread.managerScratchpad?.folderPath ?? "n/a"}`,
                `Sacred session log: ${context.thread.managerScratchpad?.sessionLogPath ?? "n/a"}`,
              ],
            });
            return;
          }

          yield* appendToManagerLog({
            threadId: context.thread.id,
            createdAt: event.payload.createdAt,
            lines: [
              `Worker created: ${context.thread.title} (${context.thread.id})`,
              `Runtime mode: ${context.thread.runtimeMode} · Interaction mode: ${context.thread.interactionMode}`,
            ],
          });
          yield* appendToWorkerLog({
            threadId: context.thread.id,
            createdAt: event.payload.createdAt,
            lines: [
              `Worker thread created as "${context.thread.title}".`,
              `Assigned manager: ${context.managerThread.title} (${context.managerThread.id})`,
            ],
          });
          return;
        }

        case "thread.meta-updated": {
          const context = yield* resolveThreadContextEventually({
            threadId: event.payload.threadId,
            predicate: (resolved) =>
              resolved.thread.role === "manager" &&
              (event.payload.title === undefined ||
                resolved.thread.title === event.payload.title) &&
              (event.payload.managerScratchpad === undefined ||
                resolved.thread.managerScratchpad?.folderPath ===
                  event.payload.managerScratchpad?.folderPath),
          });
          if (!context || context.thread.role !== "manager") {
            return;
          }

          yield* moveManagerScratchpad({
            previousScratchpad: event.payload.previousManagerScratchpad,
            nextScratchpad: event.payload.managerScratchpad,
          });
          if (event.payload.title !== undefined || event.payload.managerScratchpad !== undefined) {
            yield* appendToManagerLog({
              threadId: context.thread.id,
              createdAt: event.payload.updatedAt,
              lines: [
                `Manager renamed to "${context.thread.title}".`,
                ...(event.payload.managerScratchpad
                  ? [`Sacred folder: ${event.payload.managerScratchpad.folderPath}`]
                  : []),
              ],
            });
          }
          return;
        }

        case "manager.worker-input-requested": {
          yield* processManagerWorkerInputRequested(event);
          return;
        }

        case "thread.turn-start-requested": {
          const context = yield* resolveThreadContext(event.payload.threadId);
          if (!context) {
            return;
          }

          const message = context.thread.messages.find(
            (entry) => entry.id === event.payload.messageId && entry.role === "user",
          );
          if (!message) {
            return;
          }

          yield* appendToManagerLog({
            threadId: context.thread.id,
            createdAt: event.payload.createdAt,
            lines: [
              context.thread.role === "manager"
                ? (() => {
                    const internalAlert = extractManagerInternalAlert(message.text);
                    if (!internalAlert) {
                      return `Manager received request: ${truncateText(message.text, 600)}`;
                    }
                    return `Manager received ${internalAlert.alerts.length} internal worker update${internalAlert.alerts.length === 1 ? "" : "s"}.`;
                  })()
                : `Worker task started: ${context.thread.title}`,
              ...(context.thread.role === "manager"
                ? []
                : [`Task: ${truncateText(message.text, 600)}`]),
            ],
          });
          if (context.thread.role !== "manager") {
            yield* appendToWorkerLog({
              threadId: context.thread.id,
              createdAt: event.payload.createdAt,
              lines: [
                `Assigned task received for "${context.thread.title}".`,
                `Task: ${truncateText(message.text, 1_000)}`,
              ],
            });
          }
          return;
        }

        case "thread.message-sent": {
          if (event.payload.role !== "assistant" || event.payload.streaming) {
            return;
          }

          const context = yield* resolveThreadContextEventually({
            threadId: event.payload.threadId,
            predicate: (resolved) =>
              resolved.thread.messages.some(
                (entry) =>
                  entry.id === event.payload.messageId && entry.role === event.payload.role,
              ),
          });
          if (!context) {
            return;
          }

          const assistantMessage = context.thread.messages.find(
            (entry) => entry.id === event.payload.messageId && entry.role === "assistant",
          );
          if (!assistantMessage) {
            return;
          }

          const visibleResponse = stripManagerControlMarkup(assistantMessage.text);
          if (visibleResponse.length > 0) {
            yield* appendToManagerLog({
              threadId: context.thread.id,
              createdAt: assistantMessage.updatedAt,
              lines: [
                context.thread.role === "manager"
                  ? `Manager response: ${truncateText(visibleResponse, 1_000)}`
                  : `Worker result from "${context.thread.title}": ${truncateText(visibleResponse, 1_000)}`,
              ],
            });
            if (context.thread.role !== "manager") {
              yield* appendToWorkerLog({
                threadId: context.thread.id,
                createdAt: assistantMessage.updatedAt,
                lines: [`Worker-visible response: ${truncateText(visibleResponse, 1_000)}`],
              });
            }
          }

          if (context.thread.role === "manager") {
            if (handledManagerMessageIds.has(assistantMessage.id)) {
              return;
            }
            handledManagerMessageIds.add(assistantMessage.id);

            const manifest = extractManagerDelegation(assistantMessage.text);
            if (!manifest) {
              return;
            }

            yield* launchDelegatedWorkers({
              managerThread: context.thread,
              manifest,
              createdAt: assistantMessage.updatedAt,
            });
            yield* appendToManagerLog({
              threadId: context.thread.id,
              createdAt: assistantMessage.updatedAt,
              lines: [
                `Manager delegated ${manifest.workers.length} worker${manifest.workers.length === 1 ? "" : "s"}.`,
                ...(manifest.summary ? [`Summary: ${manifest.summary}`] : []),
              ],
            });
            return;
          }

          const workerOutcome = extractWorkerOutcome(assistantMessage.text);
          if (!workerOutcome) {
            return;
          }
          const workerMetadata = findWorkerMetadataByThreadId(
            context.managerThread,
            context.thread.id,
          );

          yield* appendToWorkerLog({
            threadId: context.thread.id,
            createdAt: assistantMessage.updatedAt,
            lines: [
              workerOutcome.kind === "complete"
                ? `Worker outcome: complete. ${truncateText(workerOutcome.content, 1_000)}`
                : `Worker outcome: blocked. ${truncateText(workerOutcome.content, 1_000)}`,
            ],
          });

          if (workerOutcome.kind === "complete") {
            yield* appendManagerActivity({
              managerThreadId: context.managerThread.id,
              kind: "manager.worker.completed",
              summary: `Worker "${context.thread.title}" completed`,
              payload: {
                ...(workerMetadata ? { workerId: workerMetadata.workerId } : {}),
                workerThreadId: context.thread.id,
                workerTitle: context.thread.title,
                response: truncateText(workerOutcome.content, 280),
              },
              createdAt: assistantMessage.updatedAt,
            });
            yield* queueAndFlushManagerAlert({
              managerThreadId: context.managerThread.id,
              alert: {
                kind: "worker.completed",
                workerThreadId: context.thread.id,
                workerTitle: context.thread.title,
                summary: "Completed the assigned work.",
                details: truncateText(workerOutcome.content, 280),
                createdAt: assistantMessage.updatedAt,
              },
            });
            yield* maybeLaunchDependencyReadyWorkers({
              managerThreadId: context.managerThread.id,
              createdAt: assistantMessage.updatedAt,
            });
            return;
          }

          yield* appendManagerActivity({
            managerThreadId: context.managerThread.id,
            kind: "manager.worker.blocked",
            summary: `Worker "${context.thread.title}" reported a blocker`,
            payload: {
              ...(workerMetadata ? { workerId: workerMetadata.workerId } : {}),
              workerThreadId: context.thread.id,
              workerTitle: context.thread.title,
              reason: truncateText(workerOutcome.content, 280),
            },
            createdAt: assistantMessage.updatedAt,
          });
          yield* queueAndFlushManagerAlert({
            managerThreadId: context.managerThread.id,
            alert: {
              kind: "worker.blocked",
              workerThreadId: context.thread.id,
              workerTitle: context.thread.title,
              summary: "Reported a blocker and needs manager follow-up.",
              details: truncateText(workerOutcome.content, 280),
              createdAt: assistantMessage.updatedAt,
            },
          });
          return;
        }

        case "thread.turn-diff-completed": {
          const context = yield* resolveThreadContext(event.payload.threadId);
          if (!context || context.thread.role === "manager") {
            return;
          }

          yield* appendToManagerLog({
            threadId: context.thread.id,
            createdAt: event.payload.completedAt,
            lines: [
              `Worker checkpoint completed: ${context.thread.title}`,
              `Status: ${event.payload.status} · Files changed: ${event.payload.files.length}`,
            ],
          });
          yield* appendToWorkerLog({
            threadId: context.thread.id,
            createdAt: event.payload.completedAt,
            lines: [
              `Checkpoint completed with status ${event.payload.status}.`,
              `Files changed: ${event.payload.files.length}`,
            ],
          });
          return;
        }

        case "thread.activity-appended": {
          const context = yield* resolveThreadContext(event.payload.threadId);
          if (!context) {
            return;
          }

          if (context.thread.role === "manager") {
            if (event.payload.activity.tone === "error") {
              yield* appendToManagerLog({
                threadId: context.thread.id,
                createdAt: event.payload.activity.createdAt,
                lines: [`Error activity on manager: ${event.payload.activity.summary}`],
              });
            }
            return;
          }

          if (event.payload.activity.kind === "approval.requested") {
            yield* appendToManagerLog({
              threadId: context.thread.id,
              createdAt: event.payload.activity.createdAt,
              lines: [
                `Worker "${context.thread.title}" is waiting on approval: ${event.payload.activity.summary}`,
              ],
            });
            yield* appendManagerActivity({
              managerThreadId: context.managerThread.id,
              kind: "manager.worker.needs-approval",
              summary: `Worker "${context.thread.title}" needs approval`,
              payload: {
                ...(findWorkerMetadataByThreadId(context.managerThread, context.thread.id)
                  ? {
                      workerId: findWorkerMetadataByThreadId(
                        context.managerThread,
                        context.thread.id,
                      )!.workerId,
                    }
                  : {}),
                workerThreadId: context.thread.id,
                workerTitle: context.thread.title,
                reason: event.payload.activity.summary,
              },
              createdAt: event.payload.activity.createdAt,
            });
            yield* queueAndFlushManagerAlert({
              managerThreadId: context.managerThread.id,
              alert: {
                kind: "worker.approval-requested",
                workerThreadId: context.thread.id,
                workerTitle: context.thread.title,
                summary: "Needs approval before it can continue.",
                details: truncateText(event.payload.activity.summary, 240),
                createdAt: event.payload.activity.createdAt,
              },
            });
            yield* appendToWorkerLog({
              threadId: context.thread.id,
              createdAt: event.payload.activity.createdAt,
              lines: [
                `Waiting on approval: ${truncateText(event.payload.activity.summary, 1_000)}`,
              ],
            });
            return;
          }

          if (event.payload.activity.kind === "user-input.requested") {
            yield* appendToManagerLog({
              threadId: context.thread.id,
              createdAt: event.payload.activity.createdAt,
              lines: [
                `Worker "${context.thread.title}" is waiting on user input: ${event.payload.activity.summary}`,
              ],
            });
            yield* appendManagerActivity({
              managerThreadId: context.managerThread.id,
              kind: "manager.worker.needs-input",
              summary: `Worker "${context.thread.title}" needs input`,
              payload: {
                ...(findWorkerMetadataByThreadId(context.managerThread, context.thread.id)
                  ? {
                      workerId: findWorkerMetadataByThreadId(
                        context.managerThread,
                        context.thread.id,
                      )!.workerId,
                    }
                  : {}),
                workerThreadId: context.thread.id,
                workerTitle: context.thread.title,
                reason: event.payload.activity.summary,
              },
              createdAt: event.payload.activity.createdAt,
            });
            yield* queueAndFlushManagerAlert({
              managerThreadId: context.managerThread.id,
              alert: {
                kind: "worker.user-input-requested",
                workerThreadId: context.thread.id,
                workerTitle: context.thread.title,
                summary: "Needs user input before it can continue.",
                details: truncateText(event.payload.activity.summary, 240),
                createdAt: event.payload.activity.createdAt,
              },
            });
            yield* appendToWorkerLog({
              threadId: context.thread.id,
              createdAt: event.payload.activity.createdAt,
              lines: [
                `Waiting on user input: ${truncateText(event.payload.activity.summary, 1_000)}`,
              ],
            });
            return;
          }

          if (event.payload.activity.tone !== "error") {
            return;
          }

          yield* appendToManagerLog({
            threadId: context.thread.id,
            createdAt: event.payload.activity.createdAt,
            lines: [
              `Error activity on worker "${context.thread.title}": ${event.payload.activity.summary}`,
            ],
          });
          yield* appendManagerActivity({
            managerThreadId: context.managerThread.id,
            kind: "manager.worker.failed",
            summary: `Worker "${context.thread.title}" hit an error`,
            payload: {
              ...(findWorkerMetadataByThreadId(context.managerThread, context.thread.id)
                ? {
                    workerId: findWorkerMetadataByThreadId(
                      context.managerThread,
                      context.thread.id,
                    )!.workerId,
                  }
                : {}),
              workerThreadId: context.thread.id,
              workerTitle: context.thread.title,
              reason: event.payload.activity.summary,
            },
            createdAt: event.payload.activity.createdAt,
            tone: "error",
          });
          yield* queueAndFlushManagerAlert({
            managerThreadId: context.managerThread.id,
            alert: {
              kind: "worker.error",
              workerThreadId: context.thread.id,
              workerTitle: context.thread.title,
              summary: "Hit an error and may need intervention.",
              details: truncateText(event.payload.activity.summary, 240),
              createdAt: event.payload.activity.createdAt,
            },
          });
          yield* appendToWorkerLog({
            threadId: context.thread.id,
            createdAt: event.payload.activity.createdAt,
            lines: [`Error activity: ${truncateText(event.payload.activity.summary, 1_000)}`],
          });
          return;
        }

        case "thread.session-set": {
          const context = yield* resolveThreadContext(event.payload.threadId);
          if (!context) {
            return;
          }

          if (context.thread.role === "manager") {
            if (
              event.payload.session.status !== "running" &&
              event.payload.session.status !== "starting"
            ) {
              clearManagerAlertDispatch(context.thread.id);
              yield* flushManagerAlerts(context.thread.id);
            }
            return;
          }

          if (
            event.payload.session.status === "error" ||
            event.payload.session.status === "interrupted" ||
            event.payload.session.status === "stopped"
          ) {
            yield* appendManagerActivity({
              managerThreadId: context.managerThread.id,
              kind: "manager.worker.status-changed",
              summary: `Worker "${context.thread.title}" is ${event.payload.session.status}`,
              payload: {
                ...(findWorkerMetadataByThreadId(context.managerThread, context.thread.id)
                  ? {
                      workerId: findWorkerMetadataByThreadId(
                        context.managerThread,
                        context.thread.id,
                      )!.workerId,
                    }
                  : {}),
                workerThreadId: context.thread.id,
                workerTitle: context.thread.title,
                status: event.payload.session.status,
                lastError: event.payload.session.lastError,
              },
              createdAt: event.payload.session.updatedAt,
            });
            yield* queueAndFlushManagerAlert({
              managerThreadId: context.managerThread.id,
              alert: {
                kind: `worker.${event.payload.session.status}`,
                workerThreadId: context.thread.id,
                workerTitle: context.thread.title,
                summary: `Session moved to ${event.payload.session.status}.`,
                details: truncateText(
                  event.payload.session.lastError ?? event.payload.session.status,
                  240,
                ),
                createdAt: event.payload.session.updatedAt,
              },
            });
            yield* appendToWorkerLog({
              threadId: context.thread.id,
              createdAt: event.payload.session.updatedAt,
              lines: [
                `Session moved to ${event.payload.session.status}.`,
                ...(event.payload.session.lastError
                  ? [`Last error: ${truncateText(event.payload.session.lastError, 1_000)}`]
                  : []),
              ],
            });
          }
          return;
        }
      }
    });
  }

  const worker = yield* makeDrainableWorker((event: RelevantEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("manager thread reactor failed to process event", {
          eventType: event.type,
          eventId: event.eventId,
          cause,
        }),
      ),
    ),
  );

  const start: ManagerThreadReactorShape["start"] = () =>
    Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        switch (event.type) {
          case "thread.created":
          case "thread.meta-updated":
          case "manager.worker-input-requested":
          case "thread.turn-start-requested":
          case "thread.message-sent":
          case "thread.turn-diff-completed":
          case "thread.activity-appended":
          case "thread.session-set":
            return worker.enqueue(event);
          default:
            return Effect.void;
        }
      }),
    );

  return {
    start,
  } satisfies ManagerThreadReactorShape;
});

export const ManagerThreadReactorLive = Layer.effect(ManagerThreadReactor, make);
