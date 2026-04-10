import { useState, useCallback, useEffect } from "react";
import { BotIcon, CalendarIcon, ClockIcon, UserIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { TimeAdjuster } from "./TimeAdjuster";
import type {
  ScheduledMessageTarget,
  DeliveryMode,
  ScheduleMessageInput,
} from "./ScheduledMessageTypes";

interface WorkerOption {
  id: string;
  title: string;
}

interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (input: ScheduleMessageInput) => void;
  workers: WorkerOption[];
  defaultTarget?: ScheduledMessageTarget;
  initialContent?: string;
  initialInput?: ScheduleMessageInput | null;
  isSubmitting?: boolean;
  title?: string;
  description?: string;
  submitLabel?: string;
}

function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  onSchedule,
  workers,
  defaultTarget = { kind: "manager" },
  initialContent = "",
  initialInput = null,
  isSubmitting = false,
  title = "Schedule message",
  description = "Send a message at a specific time instead of immediately.",
  submitLabel = "Schedule message",
}: ScheduleMessageDialogProps) {
  const [content, setContent] = useState(initialContent);
  const [scheduledDate, setScheduledDate] = useState<Date>(() => new Date());
  const [target, setTarget] = useState<ScheduledMessageTarget>(defaultTarget);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("queue");

  useEffect(() => {
    if (open) {
      setContent(initialInput?.content ?? initialContent);
      setScheduledDate(initialInput ? new Date(initialInput.scheduledFor) : new Date());
      setTarget(initialInput?.target ?? defaultTarget);
      setDeliveryMode(initialInput?.deliveryMode ?? "queue");
    }
  }, [open, initialContent, defaultTarget, initialInput]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!content.trim()) return;

      onSchedule({
        content: content.trim(),
        scheduledFor: scheduledDate.toISOString(),
        target,
        deliveryMode,
      });
    },
    [content, scheduledDate, target, deliveryMode, onSchedule],
  );

  const handleTargetChange = (kind: ScheduledMessageTarget["kind"]) => {
    if (kind === "manager") {
      setTarget({ kind: "manager" });
    } else if (workers.length > 0) {
      const firstWorker = workers[0];
      if (firstWorker) {
        setTarget({
          kind: "worker",
          workerId: firstWorker.id,
          workerTitle: firstWorker.title,
        });
      }
    }
  };

  const handleWorkerChange = (workerId: string) => {
    const worker = workers.find((w) => w.id === workerId);
    if (worker) {
      setTarget({
        kind: "worker",
        workerId: worker.id,
        workerTitle: worker.title,
      });
    }
  };

  const handleDateTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value) {
      const newDate = new Date(value);
      if (!Number.isNaN(newDate.getTime())) {
        setScheduledDate(newDate);
      }
    }
  };

  const isWorkerTarget = target.kind === "worker";
  const canSubmit = content.trim().length > 0 && !isSubmitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border border-border/60 bg-secondary text-foreground">
              <CalendarIcon className="size-4" />
            </div>
            <div>
              <DialogTitle className="font-display text-lg font-medium">{title}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground/70">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogPanel className="flex-1 overflow-y-auto py-4 space-y-4">
            <Field className="space-y-1.5">
              <FieldLabel className="text-xs text-muted-foreground">Message</FieldLabel>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Deliver this instruction at the scheduled time..."
                className="min-h-[100px] border-border/40 bg-card/50 text-sm leading-relaxed"
                disabled={isSubmitting}
              />
            </Field>

            <Field className="space-y-2">
              <FieldLabel className="text-xs text-muted-foreground">Target</FieldLabel>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleTargetChange("manager")}
                  disabled={isSubmitting}
                  className={`flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    target.kind === "manager"
                      ? "border-border bg-accent text-accent-foreground"
                      : "border-border/60 bg-card text-foreground hover:bg-accent/40"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <div className="flex items-center gap-1.5">
                    <UserIcon className="size-3.5 text-muted-foreground/70" />
                    <span className="text-sm font-medium">Coordinator</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">
                    Send to the swarm manager
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTargetChange("worker")}
                  disabled={isSubmitting || workers.length === 0}
                  className={`flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    target.kind === "worker"
                      ? "border-border bg-accent text-accent-foreground"
                      : "border-border/60 bg-card text-foreground hover:bg-accent/40"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <div className="flex items-center gap-1.5">
                    <BotIcon className="size-3.5 text-muted-foreground/70" />
                    <span className="text-sm font-medium">Worker</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">
                    Send to a specific worker
                  </span>
                </button>
              </div>
            </Field>

            {isWorkerTarget && workers.length > 0 && (
              <Field className="space-y-2">
                <FieldLabel className="text-xs text-muted-foreground">Worker</FieldLabel>
                <div className="grid grid-cols-2 gap-1.5">
                  {workers.map((worker) => (
                    <button
                      key={worker.id}
                      type="button"
                      onClick={() => handleWorkerChange(worker.id)}
                      disabled={isSubmitting}
                      className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                        target.kind === "worker" && target.workerId === worker.id
                          ? "border-border bg-accent text-accent-foreground"
                          : "border-border/60 bg-card text-foreground hover:bg-accent/40"
                      }`}
                    >
                      <div className="text-xs font-medium truncate">{worker.title}</div>
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {isWorkerTarget && (
              <Field className="space-y-2">
                <FieldLabel className="text-xs text-muted-foreground">Delivery mode</FieldLabel>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDeliveryMode("interrupt")}
                    disabled={isSubmitting}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      deliveryMode === "interrupt"
                        ? "border-border bg-accent text-accent-foreground"
                        : "border-border/60 bg-card text-foreground hover:bg-accent/40"
                    }`}
                  >
                    <div className="text-sm font-medium">Interrupt</div>
                    <div className="text-[10px] text-muted-foreground/80">
                      Stop current turn, deliver now
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryMode("queue")}
                    disabled={isSubmitting}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      deliveryMode === "queue"
                        ? "border-border bg-accent text-accent-foreground"
                        : "border-border/60 bg-card text-foreground hover:bg-accent/40"
                    }`}
                  >
                    <div className="text-sm font-medium">Queue</div>
                    <div className="text-[10px] text-muted-foreground/80">Add as follow-up</div>
                  </button>
                </div>
              </Field>
            )}

            <Field className="space-y-2">
              <FieldLabel className="text-xs text-muted-foreground">Schedule for</FieldLabel>
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <CalendarIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    type="datetime-local"
                    value={formatDateTimeLocal(scheduledDate)}
                    onChange={handleDateTimeChange}
                    disabled={isSubmitting}
                    className="border-border/40 bg-card/50 text-sm pl-8"
                  />
                </div>
                <TimeAdjuster
                  value={scheduledDate}
                  onChange={setScheduledDate}
                  stepMinutes={15}
                  disabled={isSubmitting}
                />
              </div>
              <FieldDescription className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
                <ClockIcon className="size-3" />
                <span>{formatRelativeTime(scheduledDate)}</span>
              </FieldDescription>
            </Field>
          </DialogPanel>
          <DialogFooter className="shrink-0 pt-4 border-t border-border/40">
            <Button
              type="button"
              variant="outline"
              className="text-xs"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="px-4 text-xs">
              {isSubmitting ? "Saving..." : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    return `${Math.abs(diffMins)} minute${Math.abs(diffMins) === 1 ? "" : "s"} ago`;
  } else if (diffMins === 0) {
    return "Now";
  } else if (diffMins < 60) {
    return `In ${diffMins} minute${diffMins === 1 ? "" : "s"}`;
  } else {
    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;
    if (remainingMins === 0) {
      return `In ${diffHours} hour${diffHours === 1 ? "" : "s"}`;
    }
    return `In ${diffHours}h ${remainingMins}m`;
  }
}
