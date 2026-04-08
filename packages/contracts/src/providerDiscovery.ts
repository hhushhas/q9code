import { Schema } from "effect";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

const ProviderDiscoveryProviderKind = Schema.Literals(["codex", "claudeAgent"]);

export const ProviderSkillInterface = Schema.Struct({
  displayName: Schema.optional(TrimmedNonEmptyString),
  shortDescription: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderSkillInterface = typeof ProviderSkillInterface.Type;

export const ProviderSkillDescriptor = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  scope: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  interface: Schema.optional(ProviderSkillInterface),
  dependencies: Schema.optional(Schema.Unknown),
});
export type ProviderSkillDescriptor = typeof ProviderSkillDescriptor.Type;

export const ProviderSkillReference = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
});
export type ProviderSkillReference = typeof ProviderSkillReference.Type;

export const ProviderListSkillsInput = Schema.Struct({
  provider: ProviderDiscoveryProviderKind,
  cwd: TrimmedNonEmptyString,
  threadId: Schema.optional(ThreadId),
  forceReload: Schema.optional(Schema.Boolean),
});
export type ProviderListSkillsInput = typeof ProviderListSkillsInput.Type;

export const ProviderListSkillsResult = Schema.Struct({
  skills: Schema.Array(ProviderSkillDescriptor),
  source: TrimmedNonEmptyString,
  cached: Schema.Boolean,
});
export type ProviderListSkillsResult = typeof ProviderListSkillsResult.Type;
