import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationEvent,
  ThreadId,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  extractManagerDelegation,
  MANAGER_WORKER_MODEL_SELECTION,
  stripManagerDelegation,
} from "@t3tools/shared/manager";
import { Effect, FileSystem, Layer, Path, Stream } from "effect";

import {
  ManagerThreadReactor,
  type ManagerThreadReactorShape,
} from "../Services/ManagerThreadReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";

type RelevantEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.created"
      | "thread.turn-start-requested"
      | "thread.message-sent"
      | "thread.turn-diff-completed"
      | "thread.activity-appended";
  }
>;

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

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const handledManagerMessageIds = new Set<string>();

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
    };
  });

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
    const header =
      existing.trim().length > 0
        ? existing
        : [
            `# ${context.projectTitle} manager session log`,
            "",
            `Manager thread: ${context.managerThread.title} (${context.managerThread.id})`,
            `Manager folder: ${context.managerThread.managerScratchpad?.folderPath ?? "n/a"}`,
            `Session log: ${sessionLogPath}`,
            "",
          ].join("\n");

    const separator = header.endsWith("\n") ? "" : "\n";
    yield* fileSystem.writeFileString(
      sessionLogPath,
      `${header}${separator}${asLogSection(input.createdAt, input.lines)}`,
    );
  });

  const appendManagerActivity = Effect.fn("appendManagerActivity")(function* (input: {
    readonly managerThreadId: ThreadId;
    readonly kind: string;
    readonly summary: string;
    readonly payload: Record<string, unknown>;
    readonly createdAt: string;
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("manager-thread-activity"),
      threadId: input.managerThreadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "info",
        kind: input.kind,
        summary: input.summary,
        payload: input.payload,
        turnId: null,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const launchDelegatedWorkers = Effect.fn("launchDelegatedWorkers")(function* (input: {
    readonly managerThread: OrchestrationThread;
    readonly manifest: NonNullable<ReturnType<typeof extractManagerDelegation>>;
    readonly createdAt: string;
  }) {
    for (const worker of input.manifest.workers) {
      const workerThreadId = ThreadId.makeUnsafe(crypto.randomUUID());
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: serverCommandId("manager-worker-create"),
        threadId: workerThreadId,
        projectId: input.managerThread.projectId,
        title: worker.title,
        modelSelection: MANAGER_WORKER_MODEL_SELECTION,
        role: "worker",
        managerThreadId: input.managerThread.id,
        runtimeMode: input.managerThread.runtimeMode,
        interactionMode: "default",
        branch: worker.branch === undefined ? input.managerThread.branch : worker.branch,
        worktreePath:
          worker.worktreePath === undefined
            ? input.managerThread.worktreePath
            : worker.worktreePath,
        createdAt: input.createdAt,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: serverCommandId("manager-worker-turn-start"),
        threadId: workerThreadId,
        message: {
          messageId: MessageId.makeUnsafe(crypto.randomUUID()),
          role: "user",
          text: worker.prompt,
          attachments: [],
        },
        modelSelection: MANAGER_WORKER_MODEL_SELECTION,
        titleSeed: worker.title,
        runtimeMode: input.managerThread.runtimeMode,
        interactionMode: "default",
        createdAt: input.createdAt,
      });
      yield* appendManagerActivity({
        managerThreadId: input.managerThread.id,
        kind: "manager.worker.launched",
        summary: `Launched worker "${worker.title}"`,
        payload: {
          workerThreadId,
          workerTitle: worker.title,
          task: truncateText(worker.prompt, 220),
        },
        createdAt: input.createdAt,
      });
    }
  });

  const processEvent = Effect.fn("processManagerEvent")(function* (event: RelevantEvent) {
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
              ? `Manager received request: ${truncateText(message.text, 600)}`
              : `Worker task started: ${context.thread.title}`,
            ...(context.thread.role === "manager"
              ? []
              : [`Task: ${truncateText(message.text, 600)}`]),
          ],
        });
        return;
      }

      case "thread.message-sent": {
        if (event.payload.role !== "assistant" || event.payload.streaming) {
          return;
        }

        const context = yield* resolveThreadContext(event.payload.threadId);
        if (!context) {
          return;
        }

        const assistantMessage = context.thread.messages.find(
          (entry) => entry.id === event.payload.messageId && entry.role === "assistant",
        );
        if (!assistantMessage) {
          return;
        }

        const visibleResponse = stripManagerDelegation(assistantMessage.text);
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

        yield* appendManagerActivity({
          managerThreadId: context.managerThread.id,
          kind: "manager.worker.completed",
          summary: `Worker "${context.thread.title}" completed`,
          payload: {
            workerThreadId: context.thread.id,
            workerTitle: context.thread.title,
            response: truncateText(visibleResponse, 280),
          },
          createdAt: assistantMessage.updatedAt,
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
        return;
      }

      case "thread.activity-appended": {
        const context = yield* resolveThreadContext(event.payload.threadId);
        if (!context || event.payload.activity.tone !== "error") {
          return;
        }

        yield* appendToManagerLog({
          threadId: context.thread.id,
          createdAt: event.payload.activity.createdAt,
          lines: [
            `Error activity on ${context.thread.role === "manager" ? "manager" : `worker "${context.thread.title}"`}: ${event.payload.activity.summary}`,
          ],
        });
        return;
      }
    }
  });

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

  const start: ManagerThreadReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        switch (event.type) {
          case "thread.created":
          case "thread.turn-start-requested":
          case "thread.message-sent":
          case "thread.turn-diff-completed":
          case "thread.activity-appended":
            return worker.enqueue(event);
          default:
            return Effect.void;
        }
      }),
    );
  });

  return {
    start,
  } satisfies ManagerThreadReactorShape;
});

export const ManagerThreadReactorLive = Layer.effect(ManagerThreadReactor, make);
