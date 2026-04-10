"use client";

import { cn } from "~/lib/utils";
import { Field, FieldLabel } from "~/components/ui/field";
import type { DeliveryMode } from "./ScheduledMessageTypes";

interface DeliveryModeSelectorProps {
  value: DeliveryMode;
  onChange: (mode: DeliveryMode) => void;
  disabled?: boolean;
}

const DELIVERY_MODES: Array<{
  value: DeliveryMode;
  label: string;
  description: string;
}> = [
  {
    value: "queue",
    label: "Queue",
    description: "Add to worker's input queue without interrupting current work",
  },
  {
    value: "interrupt",
    label: "Interrupt",
    description: "Immediately interrupt worker's current task and deliver now",
  },
];

export function DeliveryModeSelector({
  value,
  onChange,
  disabled = false,
}: DeliveryModeSelectorProps) {
  return (
    <Field className="gap-2">
      <FieldLabel className="text-xs text-muted-foreground">Delivery mode</FieldLabel>
      <div className="grid gap-1.5">
        {DELIVERY_MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(mode.value)}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
              value === mode.value
                ? "border-border bg-accent text-accent-foreground"
                : "border-border/60 bg-card text-foreground hover:bg-accent/40",
            )}
          >
            <span className="text-sm font-medium">{mode.label}</span>
            <span className="text-xs text-muted-foreground/70">{mode.description}</span>
          </button>
        ))}
      </div>
    </Field>
  );
}
