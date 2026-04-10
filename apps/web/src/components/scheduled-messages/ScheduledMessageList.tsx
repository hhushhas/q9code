"use client";

import { useMemo, useState } from "react";
import { CalendarIcon, ClockIcon, PlusIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card, CardHeader, CardTitle, CardPanel } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Empty, EmptyTitle, EmptyDescription } from "~/components/ui/empty";
import { ScheduledMessageCard } from "./ScheduledMessageCard";
import type {
  ScheduledMessage,
  ScheduledMessageFilter,
  ScheduledMessageSort,
} from "./ScheduledMessageTypes";

interface ScheduledMessageListProps {
  messages: ScheduledMessage[];
  onScheduleNew?: () => void;
  onCancel?: (id: string) => void;
  onEdit?: (message: ScheduledMessage) => void;
  onDelete?: (id: string) => void;
  className?: string;
  maxHeight?: string;
}

export function ScheduledMessageList({
  messages,
  onScheduleNew,
  onCancel,
  onEdit,
  onDelete,
  className,
  maxHeight = "400px",
}: ScheduledMessageListProps) {
  const [filter, setFilter] = useState<ScheduledMessageFilter>("all");
  const [sort] = useState<ScheduledMessageSort>("scheduled-asc");

  const filteredAndSortedMessages = useMemo(() => {
    let result = [...messages];

    // Apply filter
    if (filter !== "all") {
      result = result.filter((m) => m.status === filter);
    }

    // Apply sort
    result.sort((a, b) => {
      switch (sort) {
        case "scheduled-asc":
          return new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime();
        case "scheduled-desc":
          return new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime();
        case "created-desc":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default:
          return 0;
      }
    });

    return result;
  }, [messages, filter, sort]);

  const pendingCount = messages.filter((m) => m.status === "pending").length;
  const deliveredCount = messages.filter((m) => m.status === "delivered").length;
  const failedCount = messages.filter((m) => m.status === "failed").length;

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-center justify-between gap-4 pb-3">
        <div className="flex items-center gap-2">
          <ClockIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">Scheduled Messages</CardTitle>
          {messages.length > 0 && (
            <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              {messages.length}
            </span>
          )}
        </div>

        {onScheduleNew && (
          <Button variant="outline" size="sm" onClick={onScheduleNew} className="gap-1.5">
            <PlusIcon className="size-3.5" />
            <span className="hidden sm:inline">Schedule</span>
          </Button>
        )}
      </CardHeader>

      {/* Filter tabs */}
      {messages.length > 0 && (
        <div className="border-b border-border/40 px-4">
          <div className="flex gap-1">
            <FilterTab
              active={filter === "all"}
              onClick={() => setFilter("all")}
              label="All"
              count={messages.length}
            />
            <FilterTab
              active={filter === "pending"}
              onClick={() => setFilter("pending")}
              label="Pending"
              count={pendingCount}
            />
            <FilterTab
              active={filter === "delivered"}
              onClick={() => setFilter("delivered")}
              label="Delivered"
              count={deliveredCount}
            />
            {failedCount > 0 && (
              <FilterTab
                active={filter === "failed"}
                onClick={() => setFilter("failed")}
                label="Failed"
                count={failedCount}
                variant="destructive"
              />
            )}
          </div>
        </div>
      )}

      {/* Message list */}
      <CardPanel className="flex-1 p-0">
        {filteredAndSortedMessages.length === 0 ? (
          <Empty className="py-8">
            <CalendarIcon className="size-8 text-muted-foreground/30" />
            <EmptyTitle className="text-sm">
              {filter === "all" ? "No scheduled messages" : `No ${filter} messages`}
            </EmptyTitle>
            <EmptyDescription className="text-xs">
              {filter === "all" ? "Schedule messages to send them later" : "Try a different filter"}
            </EmptyDescription>
            {filter === "all" && onScheduleNew && (
              <Button variant="outline" size="sm" onClick={onScheduleNew} className="mt-3">
                <PlusIcon className="mr-1.5 size-3.5" />
                Schedule your first message
              </Button>
            )}
          </Empty>
        ) : (
          <ScrollArea className="h-full" style={{ maxHeight }}>
            <div className="space-y-2 p-4">
              {filteredAndSortedMessages.map((message) => (
                <ScheduledMessageCard
                  key={message.id}
                  message={message}
                  onCancel={onCancel}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  compact
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardPanel>
    </Card>
  );
}

interface FilterTabProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  variant?: "default" | "destructive";
}

function FilterTab({ active, onClick, label, count, variant = "default" }: FilterTabProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground/80",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0 text-[10px] tabular-nums",
          active
            ? variant === "destructive"
              ? "bg-destructive/20 text-destructive-foreground"
              : "bg-muted-foreground/20 text-muted-foreground"
            : "bg-muted/50 text-muted-foreground/60",
        )}
      >
        {count}
      </span>
      {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
    </button>
  );
}
