import * as vscode from "vscode";
import { commandIds } from "./constants";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(commandIds.createConfig, async () => undefined),
    vscode.commands.registerCommand(commandIds.fixCurrentFile, async () => undefined),
    vscode.commands.registerCommand(commandIds.updateExecutable, async () => undefined),
  );
}

export function deactivate(): void {}
