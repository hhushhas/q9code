"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";

interface TimeAdjusterProps {
  value: Date;
  onChange: (newDate: Date) => void;
  stepMinutes?: number;
  className?: string;
  disabled?: boolean;
}

export function TimeAdjuster({
  value,
  onChange,
  stepMinutes = 15,
  className,
  disabled = false,
}: TimeAdjusterProps) {
  const adjustTime = (direction: "back" | "forward") => {
    const newDate = new Date(value);
    const delta = direction === "back" ? -stepMinutes : stepMinutes;
    newDate.setMinutes(newDate.getMinutes() + delta);
    onChange(newDate);
  };

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={() => adjustTime("back")}
        className="text-muted-foreground/60 hover:text-foreground"
        aria-label={`Go back ${stepMinutes} minutes`}
      >
        <ChevronLeftIcon className="size-3.5" />
      </Button>
      <span className="min-w-[3.5rem] text-center font-mono text-xs tabular-nums text-foreground">
        {formatTime(value)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={() => adjustTime("forward")}
        className="text-muted-foreground/60 hover:text-foreground"
        aria-label={`Go forward ${stepMinutes} minutes`}
      >
        <ChevronRightIcon className="size-3.5" />
      </Button>
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
