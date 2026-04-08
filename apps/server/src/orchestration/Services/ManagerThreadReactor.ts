import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface ManagerThreadReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class ManagerThreadReactor extends ServiceMap.Service<
  ManagerThreadReactor,
  ManagerThreadReactorShape
>()("t3/orchestration/Services/ManagerThreadReactor") {}
