import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";

import { CircularStatusMeter } from "./CircularStatusMeter";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function ContextWindowMeter(props: { usage: ContextWindowSnapshot }) {
  const { usage } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);

  return (
    <CircularStatusMeter
      ariaLabel={
        usage.maxTokens !== null && usedPercentage
          ? `Context window ${usedPercentage} used`
          : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
      }
      progress={usage.usedPercentage}
      value={
        usage.usedPercentage !== null
          ? Math.round(usage.usedPercentage)
          : formatContextWindowTokens(usage.usedTokens)
      }
    >
      <div className="space-y-1.5 leading-tight">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Context window
        </div>
        {usage.maxTokens !== null && usedPercentage ? (
          <div className="whitespace-nowrap text-xs font-medium text-foreground">
            <span>{usedPercentage}</span>
            <span className="mx-1">⋅</span>
            <span>{formatContextWindowTokens(usage.usedTokens)}</span>
            <span>/</span>
            <span>{formatContextWindowTokens(usage.maxTokens ?? null)} context used</span>
          </div>
        ) : (
          <div className="text-sm text-foreground">
            {formatContextWindowTokens(usage.usedTokens)} tokens used so far
          </div>
        )}
        {(usage.totalProcessedTokens ?? null) !== null &&
        (usage.totalProcessedTokens ?? 0) > usage.usedTokens ? (
          <div className="text-xs text-muted-foreground">
            Total processed: {formatContextWindowTokens(usage.totalProcessedTokens ?? null)} tokens
          </div>
        ) : null}
        {usage.compactsAutomatically ? (
          <div className="text-xs text-muted-foreground">
            Automatically compacts its context when needed.
          </div>
        ) : null}
      </div>
    </CircularStatusMeter>
  );
}
