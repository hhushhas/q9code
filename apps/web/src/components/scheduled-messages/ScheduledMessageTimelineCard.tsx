"use client";

import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  MessageSquareIcon,
  AlertCircleIcon,
  ZapIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import type { ScheduledMessageTimelineEvent } from "./ScheduledMessageTypes";

interface ScheduledMessageTimelineCardProps {
  event: ScheduledMessageTimelineEvent;
  className?: string;
}

export function ScheduledMessageTimelineCard({
  event,
  className,
}: ScheduledMessageTimelineCardProps) {
  switch (event.kind) {
    case "scheduled-message-created":
      return <CreatedCard message={event.message} className={className} />;
    case "scheduled-message-delivered":
      return <DeliveredCard message={event.message} className={className} />;
    case "scheduled-message-delayed-delivery":
      return (
        <DelayedDeliveryCard
          message={event.message}
          originalScheduledFor={event.originalScheduledFor}
          className={className}
        />
      );
    default:
      return null;
  }
}

function CreatedCard({
  message,
  className,
}: {
  message: ScheduledMessageTimelineEvent["message"];
  className: string | undefined;
}) {
  const isWorkerTarget = message.target.kind === "worker";

  return (
    <div className={cn("rounded-lg border border-border/40 bg-card/50 px-3 py-2", className)}>
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50">
          <CalendarIcon className="size-3 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground/80">
            <span className="font-medium">Message scheduled</span>
            {isWorkerTarget ? (
              <>
                {" "}
                for worker{" "}
                <span className="font-medium">
                  {(message.target as { workerTitle: string }).workerTitle}
                </span>
              </>
            ) : (
              <> for manager</>
            )}
          </p>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/60">
            {message.content}
          </p>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
          <ClockIcon className="size-3" />
          <span className="tabular-nums">{formatTime(new Date(message.scheduledFor))}</span>
        </div>
      </div>

      {isWorkerTarget && (
        <div className="mt-1.5 flex items-center gap-1.5 pl-7">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border border-border/40 px-1 py-0 text-[9px] uppercase tracking-wide",
              message.deliveryMode === "interrupt"
                ? "border-warning/30 bg-warning/10 text-warning-foreground/80"
                : "bg-muted/30 text-muted-foreground",
            )}
          >
            {message.deliveryMode === "interrupt" ? (
              <ZapIcon className="size-2.5" />
            ) : (
              <MessageSquareIcon className="size-2.5" />
            )}
            {message.deliveryMode}
          </span>
        </div>
      )}
    </div>
  );
}

function DeliveredCard({
  message,
  className,
}: {
  message: ScheduledMessageTimelineEvent["message"];
  className: string | undefined;
}) {
  const isWorkerTarget = message.target.kind === "worker";

  return (
    <div className={cn("rounded-lg border border-success/20 bg-success/5 px-3 py-2", className)}>
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-success/30 bg-success/10">
          <CheckIcon className="size-3 text-success" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground/80">
            <span className="font-medium">Scheduled message delivered</span>
            {isWorkerTarget ? (
              <>
                {" "}
                to worker{" "}
                <span className="font-medium">
                  {(message.target as { workerTitle: string }).workerTitle}
                </span>
              </>
            ) : (
              <> to manager</>
            )}
          </p>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/60">
            {message.content}
          </p>
        </div>
      </div>

      {message.delayedDueToRecovery && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded border border-warning/20 bg-warning/5 px-2 py-1 pl-7">
          <AlertCircleIcon className="size-3 text-warning" />
          <span className="text-[10px] text-warning-foreground/80">
            Delivery was delayed due to session recovery
          </span>
        </div>
      )}
    </div>
  );
}

function DelayedDeliveryCard({
  message,
  originalScheduledFor,
  className,
}: {
  message: ScheduledMessageTimelineEvent["message"];
  originalScheduledFor: string;
  className: string | undefined;
}) {
  const isWorkerTarget = message.target.kind === "worker";

  return (
    <div className={cn("rounded-lg border border-warning/20 bg-warning/5 px-3 py-2", className)}>
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-warning/30 bg-warning/10">
          <AlertCircleIcon className="size-3 text-warning" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground/80">
            <span className="font-medium">Delayed delivery</span>
            {isWorkerTarget ? (
              <>
                {" "}
                to worker{" "}
                <span className="font-medium">
                  {(message.target as { workerTitle: string }).workerTitle}
                </span>
              </>
            ) : (
              <> to manager</>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/60">
            Originally scheduled for{" "}
            <span className="tabular-nums">{formatDateTime(new Date(originalScheduledFor))}</span>,
            delivered after session recovery
          </p>
        </div>
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
