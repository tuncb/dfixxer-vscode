import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { commandIds, extensionName } from "./constants";
import { DocumentRunGuard } from "./documentRunGuard";
import { isFileBackedDocument, isPascalDocument } from "./documentUtils";
import { resolveExecutablePath } from "./executableResolution";
import { downloadAndInstallManagedExecutable } from "./managedInstall";
import { detectRuntimePlatform, getManagedExecutableLayout } from "./managedPaths";
import { createLogger, OutputChannelLike } from "./logger";
import { ProcessRunner, execFileProcessRunner } from "./processRunner";
import { fetchDfixxerReleases, selectCompatibleReleaseAsset } from "./releaseClient";
import { getDocumentSettings, getScopedSettings, getWorkspaceFolderPath, resolveConfigurationPath } from "./vscodeSettings";

interface ExtensionTestHooks {
  fetchImpl?: typeof fetch;
  processRunner?: ProcessRunner;
  showErrorMessage?: (message: string) => Thenable<unknown>;
  showInformationMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
  showSaveDialog?: (options: vscode.SaveDialogOptions) => Thenable<vscode.Uri | undefined>;
  showTextDocument?: (document: vscode.TextDocument) => Thenable<unknown>;
  showWarningMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
}

export interface ExtensionApi {
  getLogLines(): readonly string[];
  resetTestHooks(): void;
  setTestHooks(hooks: ExtensionTestHooks): void;
}

class MirroredOutputChannel implements OutputChannelLike {
  public constructor(
    private readonly outputChannel: vscode.OutputChannel,
    private readonly logLines: string[],
  ) {}

  public appendLine(value: string): void {
    this.logLines.push(value);
    this.outputChannel.appendLine(value);
  }
}

export class ExtensionController implements vscode.Disposable, ExtensionApi {
  private readonly documentGuard = new DocumentRunGuard();
  private readonly logLines: string[] = [];
  private readonly outputChannel = vscode.window.createOutputChannel(extensionName);
  private readonly logger = createLogger(
    new MirroredOutputChannel(this.outputChannel, this.logLines),
  );
  private testHooks: ExtensionTestHooks = {};

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public register(): void {
    this.context.subscriptions.push(
      this.outputChannel,
      vscode.commands.registerCommand(commandIds.createConfig, async () => this.createConfig()),
      vscode.commands.registerCommand(commandIds.fixCurrentFile, async () => this.fixCurrentFile()),
      vscode.commands.registerCommand(commandIds.updateExecutable, () => undefined),
    );
  }

  public getLogLines(): readonly string[] {
    return [...this.logLines];
  }

  public resetTestHooks(): void {
    this.logLines.length = 0;
    this.testHooks = {};
  }

  public setTestHooks(hooks: ExtensionTestHooks): void {
    this.testHooks = {
      ...this.testHooks,
      ...hooks,
    };
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }

  private async createConfig(): Promise<void> {
    const defaultTargetUri = this.getDefaultConfigTargetUri();
    const targetUri = await this.showSaveDialog({
      defaultUri: defaultTargetUri,
      filters: {
        TOML: ["toml"],
      },
      saveLabel: "Create dfixxer Configuration",
      title: "Create dfixxer configuration file",
    });

    if (!targetUri) {
      return;
    }

    if (existsSync(targetUri.fsPath)) {
      const overwriteChoice = await this.showWarningMessage(
        `${path.basename(targetUri.fsPath)} already exists and dfixxer init-config will overwrite it.`,
        "Overwrite",
        "Cancel",
      );

      if (overwriteChoice !== "Overwrite") {
        return;
      }
    }

    const executablePath = await this.resolveExecutableForScopedCommand(targetUri);
    if (!executablePath) {
      return;
    }

    const processRunner = this.testHooks.processRunner ?? execFileProcessRunner;
    const processResult = await processRunner(
      executablePath,
      ["init-config", targetUri.fsPath],
      {
        cwd: vscode.workspace.getWorkspaceFolder(targetUri)?.uri.fsPath ?? path.dirname(targetUri.fsPath),
      },
    );

    if (processResult.exitCode !== 0) {
      this.logger.error(
        `dfixxer init-config failed for ${targetUri.fsPath} with exit code ${processResult.exitCode}.`,
      );
      if (processResult.stdout.length > 0) {
        this.logger.error(`stdout: ${processResult.stdout}`);
      }
      if (processResult.stderr.length > 0) {
        this.logger.error(`stderr: ${processResult.stderr}`);
      }

      await this.showErrorMessage(
        `dfixxer failed to create ${path.basename(targetUri.fsPath)}. See the dfixxer output channel for details.`,
      );
      return;
    }

    const createdDocument = await vscode.workspace.openTextDocument(targetUri);
    await this.showTextDocument(createdDocument);
    this.logger.info(`Created dfixxer configuration at ${targetUri.fsPath}.`);
  }

  private async fixCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      await this.showErrorMessage("Open a Pascal file before running dfixxer.");
      return;
    }

    const document = editor.document;
    if (!isPascalDocument(document)) {
      await this.showErrorMessage("dfixxer can only format Pascal files.");
      return;
    }

    if (!isFileBackedDocument(document)) {
      await this.showErrorMessage("dfixxer can only format files saved on disk.");
      return;
    }

    const result = await this.documentGuard.run(document.uri.toString(), async () => this.runFix(editor));

    if (!result.executed) {
      this.logger.info(`Skipped a re-entrant fix request for ${document.uri.fsPath}.`);
    }
  }

  private async resolveExecutableForScopedCommand(scopeUri?: vscode.Uri): Promise<string | undefined> {
    const workspaceFolderPath = scopeUri ? getWorkspaceFolderPath(scopeUri) : undefined;
    const settings = getScopedSettings(scopeUri);
    const managedLayout = getManagedExecutableLayout(this.context.globalStorageUri.fsPath);
    const executableResolution = resolveExecutablePath({
      executableSetting: settings.executablePath,
      logger: this.logger,
      managed: managedLayout,
      pathExists: (targetPath) => existsSync(targetPath),
      workspaceFolderPath,
    });

    if (executableResolution.kind === "override" || executableResolution.kind === "managed") {
      return executableResolution.executablePath;
    }

    if (executableResolution.reason === "override-not-found") {
      await this.showErrorMessage(
        `The configured dfixxer executable was not found: ${executableResolution.attemptedPath}`,
      );
      return undefined;
    }

    const installChoice = await this.showInformationMessage(
      "dfixxer is not installed yet. Install the managed executable now?",
      "Install",
      "Cancel",
    );

    if (installChoice !== "Install") {
      return undefined;
    }

    try {
      const asset = selectCompatibleReleaseAsset(
        await fetchDfixxerReleases(this.testHooks.fetchImpl ?? fetch),
        detectRuntimePlatform(),
      );
      const installResult = await downloadAndInstallManagedExecutable({
        asset,
        fetchImpl: this.testHooks.fetchImpl,
        logger: this.logger,
        managed: managedLayout,
        processRunner: this.testHooks.processRunner,
      });

      return installResult.executablePath;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Managed dfixxer installation failed: ${errorMessage}`);
      await this.showErrorMessage(
        `dfixxer could not be installed automatically. ${errorMessage}`,
      );
      return undefined;
    }
  }

  private async runFix(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    const workspaceFolderPath = getWorkspaceFolderPath(document.uri);
    const settings = getDocumentSettings(document);
    const managedLayout = getManagedExecutableLayout(this.context.globalStorageUri.fsPath);
    const executableResolution = resolveExecutablePath({
      executableSetting: settings.executablePath,
      logger: this.logger,
      managed: managedLayout,
      pathExists: (targetPath) => existsSync(targetPath),
      workspaceFolderPath,
    });

    if (executableResolution.kind === "missing") {
      const missingMessage =
        executableResolution.reason === "managed-not-installed"
          ? "No managed dfixxer executable is installed. Run \"dfixxer: Update dfixxer\" or set dfixxer.executablePath."
          : `The configured dfixxer executable was not found: ${executableResolution.attemptedPath}`;
      await this.showErrorMessage(missingMessage);
      return;
    }

    if (document.isDirty) {
      const saved = await document.save();

      if (!saved) {
        await this.showErrorMessage(`Could not save ${path.basename(document.uri.fsPath)} before running dfixxer.`);
        return;
      }
    }

    const configPath = resolveConfigurationPath(document, settings);
    const args = ["update", document.uri.fsPath];
    if (configPath) {
      args.push("--config", configPath);
    }

    this.logger.info(`Running ${executableResolution.executablePath} ${args.join(" ")}.`);

    const processRunner = this.testHooks.processRunner ?? execFileProcessRunner;
    const processResult = await processRunner(executableResolution.executablePath, args, {
      cwd: workspaceFolderPath,
    });

    if (processResult.exitCode !== 0) {
      this.logger.error(
        `dfixxer update failed for ${document.uri.fsPath} with exit code ${processResult.exitCode}.`,
      );
      if (processResult.stdout.length > 0) {
        this.logger.error(`stdout: ${processResult.stdout}`);
      }
      if (processResult.stderr.length > 0) {
        this.logger.error(`stderr: ${processResult.stderr}`);
      }

      await this.showErrorMessage(
        `dfixxer failed to format ${path.basename(document.uri.fsPath)}. See the dfixxer output channel for details.`,
      );
      return;
    }

    if (processResult.stdout.length > 0) {
      this.logger.info(`stdout: ${processResult.stdout}`);
    }
    if (processResult.stderr.length > 0) {
      this.logger.warn(`stderr: ${processResult.stderr}`);
    }

    await vscode.commands.executeCommand("workbench.action.files.revert");
    this.logger.info(`Reloaded ${document.uri.fsPath} after a successful dfixxer update.`);
  }

  private async showErrorMessage(message: string): Promise<void> {
    if (this.testHooks.showErrorMessage) {
      await this.testHooks.showErrorMessage(message);
      return;
    }

    await vscode.window.showErrorMessage(message);
  }

  private async showInformationMessage(message: string, ...items: string[]): Promise<string | undefined> {
    if (this.testHooks.showInformationMessage) {
      return this.testHooks.showInformationMessage(message, ...items);
    }

    return vscode.window.showInformationMessage(message, ...items);
  }

  private async showSaveDialog(options: vscode.SaveDialogOptions): Promise<vscode.Uri | undefined> {
    if (this.testHooks.showSaveDialog) {
      return this.testHooks.showSaveDialog(options);
    }

    return vscode.window.showSaveDialog(options);
  }

  private async showTextDocument(document: vscode.TextDocument): Promise<void> {
    if (this.testHooks.showTextDocument) {
      await this.testHooks.showTextDocument(document);
      return;
    }

    await vscode.window.showTextDocument(document);
  }

  private async showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
    if (this.testHooks.showWarningMessage) {
      return this.testHooks.showWarningMessage(message, ...items);
    }

    return vscode.window.showWarningMessage(message, ...items);
  }

  private getDefaultConfigTargetUri(): vscode.Uri | undefined {
    const activeDocument = vscode.window.activeTextEditor?.document;
    const activeWorkspaceFolder = activeDocument
      ? vscode.workspace.getWorkspaceFolder(activeDocument.uri)?.uri
      : undefined;
    const workspaceFolderUri = activeWorkspaceFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri;

    if (workspaceFolderUri) {
      return vscode.Uri.joinPath(workspaceFolderUri, "dfixxer.toml");
    }

    if (activeDocument && isFileBackedDocument(activeDocument)) {
      return vscode.Uri.file(path.join(path.dirname(activeDocument.uri.fsPath), "dfixxer.toml"));
    }

    return undefined;
  }
}
