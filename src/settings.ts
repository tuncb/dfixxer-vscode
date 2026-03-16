import * as path from "node:path";

export interface DfixxerSettings {
  configurationFile: string;
  executablePath: string;
  formatOnSave: boolean;
}

export type SettingPathResolution =
  | { kind: "unset"; input: "" }
  | { kind: "absolute"; input: string; resolvedPath: string }
  | { kind: "workspaceRelative"; input: string; resolvedPath: string; workspaceFolderPath: string }
  | { kind: "unresolvedRelative"; input: string };

export interface ResolutionContext {
  workspaceFolderPath?: string;
}

export function normalizeSettings(settings: Partial<DfixxerSettings>): DfixxerSettings {
  return {
    configurationFile: settings.configurationFile?.trim() ?? "",
    executablePath: settings.executablePath?.trim() ?? "",
    formatOnSave: settings.formatOnSave ?? false,
  };
}

export function resolveSettingPath(rawValue: string, context: ResolutionContext = {}): SettingPathResolution {
  const trimmedValue = rawValue.trim();

  if (trimmedValue.length === 0) {
    return { kind: "unset", input: "" };
  }

  if (path.isAbsolute(trimmedValue)) {
    return {
      kind: "absolute",
      input: trimmedValue,
      resolvedPath: path.normalize(trimmedValue),
    };
  }

  if (!context.workspaceFolderPath) {
    return {
      kind: "unresolvedRelative",
      input: trimmedValue,
    };
  }

  return {
    kind: "workspaceRelative",
    input: trimmedValue,
    resolvedPath: path.join(context.workspaceFolderPath, trimmedValue),
    workspaceFolderPath: context.workspaceFolderPath,
  };
}
