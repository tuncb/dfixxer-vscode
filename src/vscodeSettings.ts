import * as vscode from "vscode";
import { configurationKeys, extensionName } from "./constants";
import { DfixxerSettings, normalizeSettings, resolveSettingPath } from "./settings";

export function getScopedSettings(scope?: vscode.ConfigurationScope): DfixxerSettings {
  const configuration = vscode.workspace.getConfiguration(extensionName, scope);

  return normalizeSettings({
    configurationFile: configuration.get<string>(configurationKeys.configurationFile, ""),
    executablePath: configuration.get<string>(configurationKeys.executablePath, ""),
    formatOnSave: configuration.get<boolean>(configurationKeys.formatOnSave, false),
  });
}

export function getDocumentSettings(document: vscode.TextDocument): DfixxerSettings {
  return getScopedSettings(document);
}

export function getWorkspaceFolderPath(uri: vscode.Uri): string | undefined {
  return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
}

export function resolveConfigurationPath(
  document: vscode.TextDocument,
  settings: DfixxerSettings,
): string | undefined {
  const resolvedPath = resolveSettingPath(settings.configurationFile, {
    workspaceFolderPath: getWorkspaceFolderPath(document.uri),
  });

  switch (resolvedPath.kind) {
    case "unset":
      return undefined;
    case "absolute":
    case "workspaceRelative":
      return resolvedPath.resolvedPath;
    case "unresolvedRelative":
      return resolvedPath.input;
  }
}
