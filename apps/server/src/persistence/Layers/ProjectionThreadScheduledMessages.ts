import {
  IsoDateTime,
  OrchestrationScheduledMessageTarget,
  OrchestrationScheduledMessageStatus,
  ScheduledMessageDeliveryMode,
  ScheduledMessageId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadScheduledMessagesByThreadInput,
  ListProjectionThreadScheduledMessagesByThreadInput,
  ProjectionThreadScheduledMessage,
  ProjectionThreadScheduledMessageRepository,
  type ProjectionThreadScheduledMessageRepositoryShape,
} from "../Services/ProjectionThreadScheduledMessages.ts";

const ProjectionThreadScheduledMessageDbRow = Schema.Struct({
  scheduledMessageId: ScheduledMessageId,
  threadId: ThreadId,
  content: Schema.String,
  scheduledFor: IsoDateTime,
  target: Schema.fromJsonString(OrchestrationScheduledMessageTarget),
  deliveryMode: ScheduledMessageDeliveryMode,
  status: OrchestrationScheduledMessageStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deliveredAt: Schema.NullOr(IsoDateTime),
  cancelledAt: Schema.NullOr(IsoDateTime),
  failedAt: Schema.NullOr(IsoDateTime),
  failureReason: Schema.NullOr(TrimmedNonEmptyString),
  delayedDueToRecovery: Schema.Number,
});

const makeProjectionThreadScheduledMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadScheduledMessageRow = SqlSchema.void({
    Request: ProjectionThreadScheduledMessage,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_scheduled_messages (
          scheduled_message_id,
          thread_id,
          content,
          scheduled_for,
          target_json,
          delivery_mode,
          status,
          created_at,
          updated_at,
          delivered_at,
          cancelled_at,
          failed_at,
          failure_reason,
          delayed_due_to_recovery
        )
        VALUES (
          ${row.scheduledMessageId},
          ${row.threadId},
          ${row.content},
          ${row.scheduledFor},
          ${JSON.stringify(row.target)},
          ${row.deliveryMode},
          ${row.status},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deliveredAt},
          ${row.cancelledAt},
          ${row.failedAt},
          ${row.failureReason},
          ${row.delayedDueToRecovery ? 1 : 0}
        )
        ON CONFLICT (scheduled_message_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          content = excluded.content,
          scheduled_for = excluded.scheduled_for,
          target_json = excluded.target_json,
          delivery_mode = excluded.delivery_mode,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          delivered_at = excluded.delivered_at,
          cancelled_at = excluded.cancelled_at,
          failed_at = excluded.failed_at,
          failure_reason = excluded.failure_reason,
          delayed_due_to_recovery = excluded.delayed_due_to_recovery
      `,
  });

  const listAllProjectionThreadScheduledMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadScheduledMessageDbRow,
    execute: () =>
      sql`
        SELECT
          scheduled_message_id AS "scheduledMessageId",
          thread_id AS "threadId",
          content,
          scheduled_for AS "scheduledFor",
          target_json AS "target",
          delivery_mode AS "deliveryMode",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          delivered_at AS "deliveredAt",
          cancelled_at AS "cancelledAt",
          failed_at AS "failedAt",
          failure_reason AS "failureReason",
          delayed_due_to_recovery AS "delayedDueToRecovery"
        FROM projection_thread_scheduled_messages
        ORDER BY thread_id ASC, created_at ASC, scheduled_message_id ASC
      `,
  });

  const listProjectionThreadScheduledMessageRowsByThread = SqlSchema.findAll({
    Request: ListProjectionThreadScheduledMessagesByThreadInput,
    Result: ProjectionThreadScheduledMessageDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          scheduled_message_id AS "scheduledMessageId",
          thread_id AS "threadId",
          content,
          scheduled_for AS "scheduledFor",
          target_json AS "target",
          delivery_mode AS "deliveryMode",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          delivered_at AS "deliveredAt",
          cancelled_at AS "cancelledAt",
          failed_at AS "failedAt",
          failure_reason AS "failureReason",
          delayed_due_to_recovery AS "delayedDueToRecovery"
        FROM projection_thread_scheduled_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, scheduled_message_id ASC
      `,
  });

  const deleteProjectionThreadScheduledMessageRowsByThread = SqlSchema.void({
    Request: DeleteProjectionThreadScheduledMessagesByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_scheduled_messages
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadScheduledMessageRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadScheduledMessageRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadScheduledMessageRepository.upsert:query"),
      ),
    );

  const listAll: ProjectionThreadScheduledMessageRepositoryShape["listAll"] = () =>
    listAllProjectionThreadScheduledMessageRows().pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadScheduledMessageRepository.listAll:query"),
      ),
      Effect.map((rows) =>
        rows.map((row) => ({
          ...row,
          delayedDueToRecovery: row.delayedDueToRecovery === 1,
        })),
      ),
    );

  const listByThreadId: ProjectionThreadScheduledMessageRepositoryShape["listByThreadId"] = (
    input,
  ) =>
    listProjectionThreadScheduledMessageRowsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadScheduledMessageRepository.listByThreadId:query"),
      ),
      Effect.map((rows) =>
        rows.map((row) => ({
          ...row,
          delayedDueToRecovery: row.delayedDueToRecovery === 1,
        })),
      ),
    );

  const deleteByThreadId: ProjectionThreadScheduledMessageRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deleteProjectionThreadScheduledMessageRowsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadScheduledMessageRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    listAll,
    listByThreadId,
    deleteByThreadId,
  } satisfies ProjectionThreadScheduledMessageRepositoryShape;
});

export const ProjectionThreadScheduledMessageRepositoryLive = Layer.effect(
  ProjectionThreadScheduledMessageRepository,
  makeProjectionThreadScheduledMessageRepository,
);
