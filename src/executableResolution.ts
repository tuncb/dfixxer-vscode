import { Logger } from "./logger";
import { ManagedExecutableLayout } from "./managedPaths";
import { resolveSettingPath } from "./settings";

export type ExecutableResolution =
  | {
      kind: "override";
      executablePath: string;
      source: "setting";
      setting:
        | { kind: "absolute"; input: string; resolvedPath: string }
        | { kind: "workspaceRelative"; input: string; resolvedPath: string; workspaceFolderPath: string }
        | { kind: "unresolvedRelative"; input: string };
    }
  | {
      kind: "managed";
      executablePath: string;
      source: "managed";
      managed: ManagedExecutableLayout;
    }
  | {
      kind: "missing";
      attemptedPath: string;
      reason: "override-not-found" | "managed-not-installed";
      source: "setting" | "managed";
    };

export interface ResolveExecutableOptions {
  executableSetting: string;
  managed: ManagedExecutableLayout;
  pathExists: (targetPath: string) => boolean;
  logger: Logger;
  workspaceFolderPath?: string;
}

export function resolveExecutablePath(options: ResolveExecutableOptions): ExecutableResolution {
  const setting = resolveSettingPath(options.executableSetting, {
    workspaceFolderPath: options.workspaceFolderPath,
  });

  if (setting.kind !== "unset") {
    const candidatePath = setting.kind === "unresolvedRelative" ? setting.input : setting.resolvedPath;

    if (options.pathExists(candidatePath)) {
      options.logger.info(`Resolved executable from dfixxer.executablePath to ${candidatePath}.`);
      return {
        kind: "override",
        executablePath: candidatePath,
        source: "setting",
        setting,
      };
    }

    options.logger.warn(`Configured executable path is missing: ${candidatePath}.`);
    return {
      kind: "missing",
      attemptedPath: candidatePath,
      reason: "override-not-found",
      source: "setting",
    };
  }

  if (options.pathExists(options.managed.executablePath)) {
    options.logger.info(`Resolved executable from managed install to ${options.managed.executablePath}.`);
    return {
      kind: "managed",
      executablePath: options.managed.executablePath,
      source: "managed",
      managed: options.managed,
    };
  }

  options.logger.warn(`Managed executable is not installed at ${options.managed.executablePath}.`);
  return {
    kind: "missing",
    attemptedPath: options.managed.executablePath,
    reason: "managed-not-installed",
    source: "managed",
  };
}
