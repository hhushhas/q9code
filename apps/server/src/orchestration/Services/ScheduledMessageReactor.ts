import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface ScheduledMessageReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class ScheduledMessageReactor extends ServiceMap.Service<
  ScheduledMessageReactor,
  ScheduledMessageReactorShape
>()("t3/orchestration/Services/ScheduledMessageReactor") {}
