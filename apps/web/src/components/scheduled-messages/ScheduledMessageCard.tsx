"use client";

import {
  BotIcon,
  ClockIcon,
  EditIcon,
  MoreHorizontalIcon,
  TrashIcon,
  UserIcon,
  AlertCircleIcon,
  CheckIcon,
  XIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import type {
  ScheduledMessage,
  ScheduledMessageStatus,
  DeliveryMode,
} from "./ScheduledMessageTypes";

interface ScheduledMessageCardProps {
  message: ScheduledMessage;
  onCancel: ((id: string) => void) | undefined;
  onEdit: ((message: ScheduledMessage) => void) | undefined;
  onDelete: ((id: string) => void) | undefined;
  compact: boolean | undefined;
}

export function ScheduledMessageCard({
  message,
  onCancel,
  onEdit,
  onDelete,
  compact,
}: ScheduledMessageCardProps) {
  const isCompact = compact ?? false;
  const isPending = message.status === "pending";
  const isWorkerTarget = message.target.kind === "worker";

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-card transition-colors",
        isCompact ? "p-2.5" : "p-3.5",
        isPending ? "border-border/60 hover:border-border" : "border-border/40 bg-card/60",
      )}
    >
      {/* Header: Target + Status + Actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <TargetBadge target={message.target} />
          <StatusBadge status={message.status} />
        </div>

        {/* Actions menu */}
        {isPending && (onCancel || onEdit) && (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </Button>
              }
            />
            <MenuPopup align="end">
              {onEdit && (
                <MenuItem onClick={() => onEdit(message)}>
                  <EditIcon className="size-3.5" />
                  Edit
                </MenuItem>
              )}
              {onCancel && (
                <MenuItem onClick={() => onCancel(message.id)}>
                  <XIcon className="size-3.5" />
                  Cancel
                </MenuItem>
              )}
              {onDelete && (
                <MenuItem onClick={() => onDelete(message.id)}>
                  <TrashIcon className="size-3.5" />
                  Delete
                </MenuItem>
              )}
            </MenuPopup>
          </Menu>
        )}
      </div>

      {/* Message content */}
      <p
        className={cn(
          "mt-2 line-clamp-3 font-mono text-foreground/90",
          isCompact ? "text-xs" : "text-sm",
        )}
      >
        {message.content}
      </p>

      {/* Footer: Time + Delivery mode */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-muted-foreground/60">
            <ClockIcon className={cn("shrink-0", isCompact ? "size-3" : "size-3.5")} />
            <span className={cn("tabular-nums", isCompact ? "text-[10px]" : "text-xs")}>
              {formatScheduledTime(message.scheduledFor)}
            </span>
          </div>

          {isPending && (
            <span className={cn("text-muted-foreground/50", isCompact ? "text-[10px]" : "text-xs")}>
              • {formatTimeUntil(message.scheduledFor)}
            </span>
          )}
        </div>

        {isWorkerTarget && isPending && <DeliveryModeBadge mode={message.deliveryMode} />}
      </div>

      {/* Delayed delivery notice */}
      {message.delayedDueToRecovery && message.status === "delivered" && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-warning/20 bg-warning/5 px-2 py-1">
          <AlertCircleIcon className="size-3 text-warning" />
          <span className="text-[10px] text-warning-foreground/80">
            Delayed due to session recovery
          </span>
        </div>
      )}

      {/* Failure reason */}
      {message.status === "failed" && message.failureReason && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1">
          <AlertCircleIcon className="size-3 text-destructive" />
          <span className="text-[10px] text-destructive-foreground/80">
            {message.failureReason}
          </span>
        </div>
      )}
    </div>
  );
}

function TargetBadge({ target }: { target: ScheduledMessage["target"] }) {
  if (target.kind === "manager") {
    return (
      <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-1.5 py-0.5">
        <UserIcon className="size-3 text-muted-foreground/70" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Manager
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-1.5 py-0.5">
      <BotIcon className="size-3 text-muted-foreground/70" />
      <span className="max-w-[120px] truncate text-[10px] font-medium text-muted-foreground">
        {target.workerTitle}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: ScheduledMessageStatus }) {
  const config = getStatusConfig(status);
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} size="sm" className="gap-1 border-border/40">
      <Icon className="size-3" />
      <span className="text-[10px]">{config.label}</span>
    </Badge>
  );
}

function DeliveryModeBadge({ mode }: { mode: DeliveryMode }) {
  return (
    <span
      className={cn(
        "rounded-full border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground",
        mode === "interrupt" && "border-warning/30 bg-warning/10 text-warning-foreground/80",
      )}
    >
      {mode}
    </span>
  );
}

function getStatusConfig(status: ScheduledMessageStatus): {
  label: string;
  variant: "default" | "secondary" | "success" | "warning" | "destructive";
  icon: React.ComponentType<{ className?: string }>;
} {
  switch (status) {
    case "pending":
      return { label: "Pending", variant: "secondary", icon: ClockIcon };
    case "delivered":
      return { label: "Delivered", variant: "success", icon: CheckIcon };
    case "cancelled":
      return { label: "Cancelled", variant: "default", icon: XIcon };
    case "failed":
      return { label: "Failed", variant: "destructive", icon: AlertCircleIcon };
    default:
      return { label: "Unknown", variant: "default", icon: ClockIcon };
  }
}

function formatScheduledTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatTimeUntil(isoString: string): string {
  const target = new Date(isoString);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    return "overdue";
  } else if (diffMins === 0) {
    return "now";
  } else if (diffMins < 60) {
    return `${diffMins}m`;
  } else {
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}
