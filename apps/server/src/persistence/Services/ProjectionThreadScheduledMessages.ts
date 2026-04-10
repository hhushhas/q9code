import {
  IsoDateTime,
  OrchestrationScheduledMessageStatus,
  OrchestrationScheduledMessageTarget,
  ScheduledMessageDeliveryMode,
  ScheduledMessageId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadScheduledMessage = Schema.Struct({
  scheduledMessageId: ScheduledMessageId,
  threadId: ThreadId,
  content: Schema.String,
  scheduledFor: IsoDateTime,
  target: OrchestrationScheduledMessageTarget,
  deliveryMode: ScheduledMessageDeliveryMode,
  status: OrchestrationScheduledMessageStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deliveredAt: Schema.NullOr(IsoDateTime),
  cancelledAt: Schema.NullOr(IsoDateTime),
  failedAt: Schema.NullOr(IsoDateTime),
  failureReason: Schema.NullOr(TrimmedNonEmptyString),
  delayedDueToRecovery: Schema.Boolean,
});
export type ProjectionThreadScheduledMessage = typeof ProjectionThreadScheduledMessage.Type;

export const ListProjectionThreadScheduledMessagesByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadScheduledMessagesByThreadInput =
  typeof ListProjectionThreadScheduledMessagesByThreadInput.Type;

export const DeleteProjectionThreadScheduledMessagesByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadScheduledMessagesByThreadInput =
  typeof DeleteProjectionThreadScheduledMessagesByThreadInput.Type;

export interface ProjectionThreadScheduledMessageRepositoryShape {
  readonly upsert: (
    row: ProjectionThreadScheduledMessage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionThreadScheduledMessage>,
    ProjectionRepositoryError
  >;
  readonly listByThreadId: (
    input: ListProjectionThreadScheduledMessagesByThreadInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadScheduledMessage>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadScheduledMessagesByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadScheduledMessageRepository extends ServiceMap.Service<
  ProjectionThreadScheduledMessageRepository,
  ProjectionThreadScheduledMessageRepositoryShape
>()(
  "t3/persistence/Services/ProjectionThreadScheduledMessages/ProjectionThreadScheduledMessageRepository",
) {}
