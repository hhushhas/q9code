import {
  type UsageLimitSnapshot,
  formatUsageLimitPercentage,
  formatUsageLimitResetAt,
  formatUsageLimitWindowLabel,
} from "~/lib/usageLimits";

import { CircularStatusMeter } from "./CircularStatusMeter";

export function UsageLimitMeter(props: { usage: UsageLimitSnapshot }) {
  const { usage } = props;
  const activeLabel = formatUsageLimitWindowLabel(
    usage.activeWindow.windowDurationMins,
    usage.primary ? "5-hour" : "weekly",
  );
  const activePercentage = formatUsageLimitPercentage(usage.activeWindow.usedPercentage);
  const limitBucket = usage.limitName ?? usage.limitId;
  const windows = [
    ...(usage.primary
      ? [
          {
            key: "primary",
            label: formatUsageLimitWindowLabel(usage.primary.windowDurationMins, "5-hour"),
            usedPercentage: formatUsageLimitPercentage(usage.primary.usedPercentage),
            resetsAt: formatUsageLimitResetAt(usage.primary.resetsAt),
          },
        ]
      : []),
    ...(usage.secondary
      ? [
          {
            key: "secondary",
            label: formatUsageLimitWindowLabel(usage.secondary.windowDurationMins, "weekly"),
            usedPercentage: formatUsageLimitPercentage(usage.secondary.usedPercentage),
            resetsAt: formatUsageLimitResetAt(usage.secondary.resetsAt),
          },
        ]
      : []),
  ];

  return (
    <CircularStatusMeter
      ariaLabel={
        activePercentage
          ? `${activeLabel} usage limit ${activePercentage} used`
          : `${activeLabel} usage limit`
      }
      progress={usage.activeWindow.normalizedUsedPercentage}
      value={Math.round(usage.activeWindow.normalizedUsedPercentage)}
    >
      <div className="space-y-1.5 leading-tight">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Usage limit
        </div>
        <div className="whitespace-nowrap text-xs font-medium text-foreground">
          <span>{activePercentage ?? `${Math.round(usage.activeWindow.usedPercentage)}%`}</span>
          <span className="mx-1">⋅</span>
          <span>{activeLabel} limit</span>
        </div>
        {windows.map((window) => (
          <div key={window.key} className="text-xs text-muted-foreground">
            <span className="text-foreground">{window.label}</span>
            <span className="mx-1">⋅</span>
            <span>{window.usedPercentage ?? "0%"}</span>
            <span className="mx-1">used</span>
            {window.resetsAt ? (
              <>
                <span className="mx-1">⋅</span>
                <span>resets {window.resetsAt}</span>
              </>
            ) : null}
          </div>
        ))}
        {limitBucket && !limitBucket.toLowerCase().startsWith("codex") ? (
          <div className="text-xs text-muted-foreground">Bucket: {limitBucket}</div>
        ) : null}
      </div>
    </CircularStatusMeter>
  );
}
