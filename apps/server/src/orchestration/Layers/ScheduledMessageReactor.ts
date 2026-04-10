import {
  CommandId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationScheduledMessage,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { Cause, Duration, Effect, Fiber, Layer, Stream } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ScheduledMessageReactor,
  type ScheduledMessageReactorShape,
} from "../Services/ScheduledMessageReactor.ts";

type ScheduledMessageEvent = Extract<
  OrchestrationEvent,
  { type: "thread.scheduled-message-upserted" }
>;

interface SchedulerInput {
  readonly threadId: ThreadId;
  readonly scheduledMessage: OrchestrationScheduledMessage;
  readonly delayedDueToRecovery: boolean;
}

const serverCommandId = (tag: string) =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);
const messageKey = (threadId: ThreadId, scheduledMessageId: OrchestrationScheduledMessage["id"]) =>
  `${threadId}:${scheduledMessageId}`;

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const scheduledFibers = new Map<string, Fiber.Fiber<void, never>>();

  const clearScheduledFiber = (key: string) => {
    scheduledFibers.delete(key);
  };

  const cancelScheduledFiber = (key: string) =>
    Effect.gen(function* () {
      const existingFiber = scheduledFibers.get(key);
      if (!existingFiber) {
        return;
      }
      scheduledFibers.delete(key);
      yield* Fiber.interrupt(existingFiber);
    });

  const markScheduledMessageFailed = (input: {
    readonly threadId: ThreadId;
    readonly scheduledMessageId: OrchestrationScheduledMessage["id"];
    readonly failureReason: string;
    readonly at: string;
  }) =>
    orchestrationEngine
      .dispatch({
        type: "thread.scheduled-message.mark-failed",
        commandId: serverCommandId("scheduled-message-failed"),
        threadId: input.threadId,
        scheduledMessageId: input.scheduledMessageId,
        failureReason: input.failureReason.trim() || "Scheduled delivery failed.",
        failedAt: input.at,
        createdAt: input.at,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("scheduled message reactor failed to mark message as failed", {
            threadId: input.threadId,
            scheduledMessageId: input.scheduledMessageId,
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.asVoid,
      );

  const deliverScheduledMessage = (input: SchedulerInput) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const ownerThread =
        readModel.threads.find(
          (thread) => thread.id === input.threadId && thread.deletedAt === null,
        ) ?? null;
      const scheduledMessage =
        ownerThread?.scheduledMessages.find(
          (message) => message.id === input.scheduledMessage.id && message.status === "pending",
        ) ?? null;
      if (!ownerThread || !scheduledMessage) {
        return;
      }

      const deliveredAt = new Date().toISOString();
      const deliveryMessageId = MessageId.makeUnsafe(crypto.randomUUID());

      const dispatchDelivery = () => {
        const target = scheduledMessage.target;

        if (target.kind === "manager") {
          const managerThread =
            readModel.threads.find(
              (thread) => thread.id === target.managerThreadId && thread.deletedAt === null,
            ) ?? null;
          if (!managerThread) {
            return Effect.fail(new Error("Manager thread is no longer available for delivery."));
          }

          return orchestrationEngine.dispatch({
            type: "thread.turn.start",
            commandId: serverCommandId("scheduled-message-manager-delivery"),
            threadId: managerThread.id,
            message: {
              messageId: deliveryMessageId,
              role: "user",
              text: scheduledMessage.content,
              attachments: [],
            },
            titleSeed: managerThread.title,
            runtimeMode: managerThread.runtimeMode,
            interactionMode: managerThread.interactionMode,
            createdAt: deliveredAt,
          });
        }

        if (target.kind !== "worker") {
          return Effect.fail(new Error("Unsupported scheduled message target."));
        }

        if ((ownerThread.role ?? "worker") === "manager") {
          return orchestrationEngine.dispatch({
            type: "manager.worker.input.send",
            commandId: serverCommandId("scheduled-message-worker-delivery"),
            managerThreadId: ownerThread.id,
            workerThreadId: target.workerThreadId,
            input: {
              messageId: deliveryMessageId,
              text: scheduledMessage.content,
              attachments: [],
            },
            mode: scheduledMessage.deliveryMode,
            createdAt: deliveredAt,
          });
        }

        const workerThread =
          readModel.threads.find(
            (thread) => thread.id === target.workerThreadId && thread.deletedAt === null,
          ) ?? null;
        if (!workerThread) {
          return Effect.fail(new Error("Worker thread is no longer available for delivery."));
        }

        const workerIsRunning =
          workerThread.session?.status === "running" ||
          (workerThread.latestTurn !== null && workerThread.latestTurn.completedAt === null);

        const interruptIfNeeded =
          scheduledMessage.deliveryMode === "interrupt" && workerIsRunning
            ? orchestrationEngine.dispatch({
                type: "thread.turn.interrupt",
                commandId: serverCommandId("scheduled-message-worker-interrupt"),
                threadId: workerThread.id,
                ...(workerThread.session?.activeTurnId !== null &&
                workerThread.session?.activeTurnId !== undefined
                  ? { turnId: workerThread.session.activeTurnId }
                  : {}),
                createdAt: deliveredAt,
              })
            : Effect.succeed({ sequence: readModel.snapshotSequence });

        return interruptIfNeeded.pipe(
          Effect.flatMap(() =>
            orchestrationEngine.dispatch({
              type: "thread.turn.start",
              commandId: serverCommandId("scheduled-message-worker-turn-start"),
              threadId: workerThread.id,
              message: {
                messageId: deliveryMessageId,
                role: "user",
                text: scheduledMessage.content,
                attachments: [],
              },
              titleSeed: workerThread.title,
              runtimeMode: workerThread.runtimeMode,
              interactionMode: workerThread.interactionMode,
              createdAt: deliveredAt,
            }),
          ),
        );
      };

      const deliveryExit = yield* Effect.exit(dispatchDelivery());
      if (deliveryExit._tag === "Failure") {
        const failureReason =
          Cause.squash(deliveryExit.cause) instanceof Error
            ? (Cause.squash(deliveryExit.cause) as Error).message
            : "Scheduled delivery failed.";
        yield* markScheduledMessageFailed({
          threadId: input.threadId,
          scheduledMessageId: scheduledMessage.id,
          failureReason,
          at: deliveredAt,
        });
        return;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.scheduled-message.mark-delivered",
        commandId: serverCommandId("scheduled-message-delivered"),
        threadId: input.threadId,
        scheduledMessageId: scheduledMessage.id,
        deliveredAt,
        delayedDueToRecovery: input.delayedDueToRecovery,
        createdAt: deliveredAt,
      });
    });

  const schedulePendingMessage = (input: SchedulerInput) =>
    Effect.gen(function* () {
      const key = messageKey(input.threadId, input.scheduledMessage.id);
      yield* cancelScheduledFiber(key);

      if (input.scheduledMessage.status !== "pending") {
        return;
      }

      const scheduledForMs = Date.parse(input.scheduledMessage.scheduledFor);
      const delayMs = Number.isNaN(scheduledForMs) ? 0 : Math.max(0, scheduledForMs - Date.now());

      const fiber = yield* Effect.forkScoped(
        Effect.sleep(Duration.millis(delayMs)).pipe(
          Effect.flatMap(() => deliverScheduledMessage(input)),
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.void;
            }
            return Effect.logWarning("scheduled message reactor delivery failed", {
              threadId: input.threadId,
              scheduledMessageId: input.scheduledMessage.id,
              cause: Cause.pretty(cause),
            });
          }),
          Effect.ensuring(Effect.sync(() => clearScheduledFiber(key))),
        ),
      );

      scheduledFibers.set(key, fiber);
    });

  const worker = yield* makeDrainableWorker(schedulePendingMessage);

  const enqueueEvent = (event: ScheduledMessageEvent) =>
    worker.enqueue({
      threadId: event.payload.threadId,
      scheduledMessage: event.payload.scheduledMessage,
      delayedDueToRecovery: false,
    });

  const start: ScheduledMessageReactorShape["start"] = Effect.fn("start")(function* () {
    const snapshot = yield* projectionSnapshotQuery.getSnapshot().pipe(
      Effect.catch((error) =>
        Effect.logWarning("scheduled message reactor failed to load snapshot during startup", {
          cause: error,
        }).pipe(
          Effect.as({
            threads: [] as Array<{
              id: ThreadId;
              scheduledMessages: OrchestrationScheduledMessage[];
            }>,
          }),
        ),
      ),
    );

    for (const thread of snapshot.threads) {
      for (const scheduledMessage of thread.scheduledMessages) {
        if (scheduledMessage.status !== "pending") {
          continue;
        }
        const delayedDueToRecovery =
          !Number.isNaN(Date.parse(scheduledMessage.scheduledFor)) &&
          Date.parse(scheduledMessage.scheduledFor) <= Date.now();
        yield* worker.enqueue({
          threadId: thread.id,
          scheduledMessage,
          delayedDueToRecovery,
        });
      }
    }

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.scheduled-message-upserted") {
          return Effect.void;
        }
        return enqueueEvent(event);
      }),
    );

    // Give the subscriber fiber a turn to attach before callers dispatch new
    // scheduled-message events immediately after `start()` resolves.
    yield* Effect.yieldNow;
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ScheduledMessageReactorShape;
});

export const ScheduledMessageReactorLive = Layer.effect(ScheduledMessageReactor, make);
