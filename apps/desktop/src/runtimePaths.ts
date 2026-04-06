import * as Path from "node:path";

export function resolveDesktopBaseDir(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly homedir: string;
}): string {
  return (
    input.env.Q9CODE_HOME?.trim() ||
    input.env.T3CODE_HOME?.trim() ||
    Path.join(input.homedir, ".t3")
  );
}
