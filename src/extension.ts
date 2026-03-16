import * as vscode from "vscode";
import { ExtensionApi, ExtensionController } from "./extensionController";

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const controller = new ExtensionController(context);
  controller.register();
  context.subscriptions.push(controller);
  return controller;
}

export function deactivate(): void {}
