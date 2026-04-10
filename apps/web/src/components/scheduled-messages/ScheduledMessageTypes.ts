// Scheduled Message Types
// These types define the UI layer contracts for scheduled messages.
// The actual persistence and orchestration are handled separately.

import type { OrchestrationScheduledMessage } from "@t3tools/contracts";

export type ScheduledMessageId = string;

export type ScheduledMessageTarget =
  | { kind: "manager" }
  | { kind: "worker"; workerId: string; workerTitle: string };

export type DeliveryMode = "queue" | "interrupt";

export type ScheduledMessageStatus =
  | "pending" // Waiting for scheduled time
  | "delivered" // Successfully delivered
  | "cancelled" // Cancelled by user
  | "failed"; // Failed to deliver

export interface ScheduledMessage {
  id: ScheduledMessageId;
  ownerThreadId?: string;
  content: string;
  scheduledFor: string; // ISO timestamp
  target: ScheduledMessageTarget;
  deliveryMode: DeliveryMode; // Only applies to worker targets
  status: ScheduledMessageStatus;
  createdAt: string; // ISO timestamp
  deliveredAt?: string; // ISO timestamp, only for delivered status
  cancelledAt?: string; // ISO timestamp, only for cancelled status
  failedAt?: string; // ISO timestamp, only for failed status
  failureReason?: string; // Only for failed status
  delayedDueToRecovery?: boolean; // True if delivery was delayed due to session recovery
}

export function toScheduledMessage(message: OrchestrationScheduledMessage): ScheduledMessage {
  return {
    id: message.id,
    ownerThreadId: message.ownerThreadId,
    content: message.content,
    scheduledFor: message.scheduledFor,
    target:
      message.target.kind === "manager"
        ? { kind: "manager" }
        : {
            kind: "worker",
            workerId: message.target.workerThreadId,
            workerTitle: message.target.workerTitle,
          },
    deliveryMode: message.deliveryMode,
    status: message.status,
    createdAt: message.createdAt,
    ...(message.deliveredAt ? { deliveredAt: message.deliveredAt } : {}),
    ...(message.cancelledAt ? { cancelledAt: message.cancelledAt } : {}),
    ...(message.failedAt ? { failedAt: message.failedAt } : {}),
    ...(message.failureReason ? { failureReason: message.failureReason } : {}),
    ...(message.delayedDueToRecovery ? { delayedDueToRecovery: true } : {}),
  };
}

export function deriveScheduledMessageTimelineEvents(
  messages: ReadonlyArray<OrchestrationScheduledMessage>,
): ScheduledMessageTimelineEvent[] {
  const events: ScheduledMessageTimelineEvent[] = [];

  for (const message of messages) {
    const scheduledMessage = toScheduledMessage(message);
    events.push({
      kind: "scheduled-message-created",
      message: scheduledMessage,
    });

    if (message.status === "delivered") {
      events.push(
        message.delayedDueToRecovery
          ? {
              kind: "scheduled-message-delayed-delivery",
              message: scheduledMessage,
              originalScheduledFor: message.scheduledFor,
            }
          : {
              kind: "scheduled-message-delivered",
              message: scheduledMessage,
            },
      );
    }
  }

  return events;
}

// Props for scheduling a new message
export interface ScheduleMessageInput {
  content: string;
  scheduledFor: string; // ISO timestamp
  target: ScheduledMessageTarget;
  deliveryMode: DeliveryMode;
}

// Timeline event kinds for scheduled messages
export type ScheduledMessageTimelineEvent =
  | { kind: "scheduled-message-created"; message: ScheduledMessage }
  | { kind: "scheduled-message-delivered"; message: ScheduledMessage }
  | {
      kind: "scheduled-message-delayed-delivery";
      message: ScheduledMessage;
      originalScheduledFor: string;
    };

// Filter options for the scheduled message list
export type ScheduledMessageFilter = "all" | "pending" | "delivered" | "failed";

// Sort order for the scheduled message list
export type ScheduledMessageSort = "scheduled-asc" | "scheduled-desc" | "created-desc";
