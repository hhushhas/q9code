/**
 * Keep Effect runtime packages aligned in staged desktop builds.
 *
 * `@effect/platform-node` depends on `@effect/platform-node-shared` using a
 * range. In isolated staging installs that can drift to a newer shared package
 * than the pinned `effect` version, causing runtime import failures.
 */
export function ensureEffectRuntimeDependencyPins(
  dependencies: Record<string, unknown>,
): Record<string, unknown> {
  const platformNodeVersion = dependencies["@effect/platform-node"];
  const platformNodeSharedVersion = dependencies["@effect/platform-node-shared"];

  if (typeof platformNodeVersion !== "string" || platformNodeVersion.length === 0) {
    return dependencies;
  }

  if (typeof platformNodeSharedVersion === "string" && platformNodeSharedVersion.length > 0) {
    return dependencies;
  }

  return {
    ...dependencies,
    "@effect/platform-node-shared": platformNodeVersion,
  };
}
