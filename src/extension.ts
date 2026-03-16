import * as vscode from "vscode";
import { commandIds } from "./constants";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(commandIds.createConfig, () => undefined),
    vscode.commands.registerCommand(commandIds.fixCurrentFile, () => undefined),
    vscode.commands.registerCommand(commandIds.updateExecutable, () => undefined),
  );
}

export function deactivate(): void {}
