import * as path from 'node:path';

export function resolveProjectRoot(
  args: string[],
  cwd: string = process.cwd(),
  envProjectRoot: string | undefined = process.env.ROADIE_PROJECT_ROOT,
): string {
  const projectFlagIndex = args.findIndex((arg) => arg === '--project');
  const projectFlagValue = projectFlagIndex >= 0 ? args[projectFlagIndex + 1] : undefined;
  if (projectFlagValue) {
    return path.resolve(projectFlagValue);
  }

  const positionalPath = args.find((arg) => !arg.startsWith('-'));
  if (positionalPath) {
    return path.resolve(positionalPath);
  }

  if (envProjectRoot) {
    return path.resolve(envProjectRoot);
  }

  return path.resolve(cwd);
}