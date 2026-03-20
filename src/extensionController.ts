import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { commandIds, extensionName } from "./constants";
import { DocumentRunGuard } from "./documentRunGuard";
import { isFileBackedDocument, isPascalDocument } from "./documentUtils";
import { resolveExecutablePath } from "./executableResolution";
import {
  downloadAndInstallManagedExecutable,
  managedExecutableReportsRelease,
  readManagedInstallMetadata,
} from "./managedInstall";
import { detectRuntimePlatform, getManagedExecutableLayout, RuntimePlatform } from "./managedPaths";
import { createLogger, OutputChannelLike } from "./logger";
import { ProcessResult, ProcessRunner, execFileProcessRunner } from "./processRunner";
import { fetchPinnedDfixxerRelease, selectCompatibleReleaseAsset } from "./releaseClient";
import { getDocumentSettings, getScopedSettings, getWorkspaceFolderPath, resolveConfigurationPath } from "./vscodeSettings";

interface ExtensionTestHooks {
  fetchImpl?: typeof fetch;
  processRunner?: ProcessRunner;
  runtimePlatform?: RuntimePlatform;
  showErrorMessage?: (message: string) => Thenable<unknown>;
  showInformationMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
  showSaveDialog?: (options: vscode.SaveDialogOptions) => Thenable<vscode.Uri | undefined>;
  showTextDocument?: (document: vscode.TextDocument) => Thenable<unknown>;
  showWarningMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
}

export interface ExtensionApi {
  clearManagedInstallForTest(): Promise<void>;
  getLogLines(): readonly string[];
  invokeDidSaveForTest(document: vscode.TextDocument): Promise<void>;
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
  private readonly suppressedSaveDocuments = new Set<string>();
  private readonly logger = createLogger(
    new MirroredOutputChannel(this.outputChannel, this.logLines),
  );
  private testHooks: ExtensionTestHooks = {};

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public register(): void {
    this.context.subscriptions.push(
      this.outputChannel,
      vscode.workspace.onDidSaveTextDocument((document) => {
        void this.handleDidSaveTextDocument(document);
      }),
      vscode.commands.registerCommand(commandIds.createConfig, async () => this.createConfig()),
      vscode.commands.registerCommand(commandIds.fixCurrentFile, async () => this.fixCurrentFile()),
      vscode.commands.registerCommand(commandIds.updateExecutable, async () => this.updateExecutable()),
    );
  }

  public getLogLines(): readonly string[] {
    return [...this.logLines];
  }

  public async clearManagedInstallForTest(): Promise<void> {
    const managedLayout = this.getManagedExecutableLayout();
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(managedLayout.installDirectory), {
        recursive: true,
        useTrash: false,
      });
    } catch {
      // Ignore missing test state.
    }
  }

  public async invokeDidSaveForTest(document: vscode.TextDocument): Promise<void> {
    await this.handleDidSaveTextDocument(document);
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

  private async updateExecutable(): Promise<void> {
    const updateResult = await this.installManagedExecutable();
    if (!updateResult) {
      return;
    }

    if (updateResult.kind === "noop") {
      await this.showInformationMessage(
        `Managed dfixxer ${updateResult.metadata.releaseTag} is already up to date.`,
      );
    } else {
      await this.showInformationMessage(
        `Updated managed dfixxer to ${updateResult.metadata.releaseTag}.`,
      );
    }

    const scopedSettings = getScopedSettings(this.getPreferredScopeUri());
    if (scopedSettings.executablePath.length > 0) {
      await this.showWarningMessage(
        "dfixxer.executablePath is set, so the configured override remains authoritative over the managed executable.",
      );
    }
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
    const managedLayout = this.getManagedExecutableLayout();
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

    const updateResult = await this.installManagedExecutable();
    return updateResult?.executablePath;
  }

  private async installManagedExecutable(): Promise<
    | {
        executablePath: string;
        kind: "installed" | "noop";
        metadata: {
          assetName: string;
          releaseTag: string;
        };
      }
    | undefined
  > {
    try {
      const runtimePlatform = this.getRuntimePlatform();
      const managedLayout = this.getManagedExecutableLayout(runtimePlatform);
      const asset = selectCompatibleReleaseAsset(
        await fetchPinnedDfixxerRelease(this.testHooks.fetchImpl ?? fetch),
        runtimePlatform,
      );
      const currentMetadata = await readManagedInstallMetadata(managedLayout.metadataPath);

      if (
        currentMetadata &&
        currentMetadata.releaseTag === asset.releaseTag &&
        existsSync(managedLayout.executablePath)
      ) {
        const isCurrentManagedInstall = await this.isCurrentManagedInstall(
          managedLayout.executablePath,
          asset.releaseTag,
        );
        if (isCurrentManagedInstall) {
          this.logger.info(`Managed dfixxer ${currentMetadata.releaseTag} is already current.`);
          return {
            executablePath: managedLayout.executablePath,
            kind: "noop",
            metadata: currentMetadata,
          };
        }

        this.logger.warn(
          `Managed dfixxer metadata reports ${currentMetadata.releaseTag}, but ${managedLayout.executablePath} did not verify as ${asset.releaseTag}; reinstalling.`,
        );
      }

      const installResult = await downloadAndInstallManagedExecutable({
        asset,
        fetchImpl: this.testHooks.fetchImpl,
        logger: this.logger,
        managed: managedLayout,
        processRunner: this.testHooks.processRunner,
      });

      return {
        executablePath: installResult.executablePath,
        kind: "installed",
        metadata: installResult.metadata,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Managed dfixxer installation failed: ${errorMessage}`);
      await this.showErrorMessage(
        `dfixxer could not be installed automatically. ${errorMessage}`,
      );
      return undefined;
    }
  }

  private getManagedExecutableLayout(runtimePlatform = this.getRuntimePlatform()) {
    return getManagedExecutableLayout(this.context.globalStorageUri.fsPath, runtimePlatform);
  }

  private getRuntimePlatform(): RuntimePlatform {
    return this.testHooks.runtimePlatform ?? detectRuntimePlatform();
  }

  private async isCurrentManagedInstall(executablePath: string, expectedReleaseTag: string): Promise<boolean> {
    try {
      return await managedExecutableReportsRelease(
        executablePath,
        expectedReleaseTag,
        this.testHooks.processRunner ?? execFileProcessRunner,
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Managed executable validation failed for ${executablePath}: ${errorMessage}`);
      return false;
    }
  }

  private async runFix(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    const executablePath = await this.resolveExecutableForScopedCommand(document.uri);
    if (!executablePath) {
      return;
    }

    if (document.isDirty) {
      this.suppressedSaveDocuments.add(document.uri.toString());
      const saved = await document.save();

      if (!saved) {
        this.suppressedSaveDocuments.delete(document.uri.toString());
        await this.showErrorMessage(`Could not save ${path.basename(document.uri.fsPath)} before running dfixxer.`);
        return;
      }

      await this.delay(this.getPostSaveDelayMilliseconds());
    }

    const workspaceFolderPath = getWorkspaceFolderPath(document.uri);
    const settings = getDocumentSettings(document);
    const configPath = resolveConfigurationPath(document, settings);
    const args = ["update", document.uri.fsPath];
    if (configPath) {
      args.push("--config", configPath);
    }

    this.logger.info(`Running ${executablePath} ${args.join(" ")}.`);

    const processRunner = this.testHooks.processRunner ?? execFileProcessRunner;
    const dirtyStateTracker = this.trackDocumentDirtyState(document);
    let processResult: ProcessResult;
    try {
      processResult = await this.runFormatterProcess(processRunner, executablePath, args, workspaceFolderPath);
    } catch (error: unknown) {
      dirtyStateTracker.dispose();
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`dfixxer update failed for ${document.uri.fsPath}: ${errorMessage}`);
      await this.showErrorMessage(
        `dfixxer failed to format ${path.basename(document.uri.fsPath)}. See the dfixxer output channel for details.`,
      );
      return;
    }

    if (processResult.exitCode !== 0) {
      dirtyStateTracker.dispose();
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

    const documentBecameDirty = dirtyStateTracker.didBecomeDirty();
    dirtyStateTracker.dispose();
    if (documentBecameDirty || document.isDirty) {
      this.logger.warn(
        `Skipped reloading ${document.uri.fsPath} because the document changed while dfixxer was running.`,
      );
      return;
    }

    await this.reloadDocument(document);
  }

  private async handleDidSaveTextDocument(document: vscode.TextDocument): Promise<void> {
    const documentKey = document.uri.toString();
    if (this.suppressedSaveDocuments.delete(documentKey)) {
      this.logger.info(`Skipped save-triggered formatting for ${document.uri.fsPath} after a command-managed save.`);
      return;
    }

    if (!isPascalDocument(document) || !isFileBackedDocument(document)) {
      return;
    }

    const settings = getDocumentSettings(document);
    if (!settings.formatOnSave) {
      return;
    }

    await this.delay(this.getPostSaveDelayMilliseconds());
    const result = await this.documentGuard.run(documentKey, async () => this.runFixFromSave(document));
    if (!result.executed) {
      this.logger.info(`Skipped a re-entrant save-triggered fix for ${document.uri.fsPath}.`);
    }
  }

  private async runFixFromSave(document: vscode.TextDocument): Promise<void> {
    const editor = await this.ensureVisibleEditor(document);
    if (!editor) {
      return;
    }

    await this.runFix(editor);
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

  private getPreferredScopeUri(): vscode.Uri | undefined {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument) {
      return activeDocument.uri;
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private async ensureVisibleEditor(document: vscode.TextDocument): Promise<vscode.TextEditor | undefined> {
    const visibleEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === document.uri.toString(),
    );

    if (visibleEditor) {
      return visibleEditor;
    }

    try {
      return await vscode.window.showTextDocument(document, { preserveFocus: true, preview: false });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not show ${document.uri.fsPath} for reload after formatting: ${errorMessage}`);
      return undefined;
    }
  }

  private trackDocumentDirtyState(document: vscode.TextDocument): {
    didBecomeDirty: () => boolean;
    dispose: () => void;
  } {
    let becameDirty = false;
    const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString() && event.document.isDirty) {
        becameDirty = true;
      }
    });

    return {
      didBecomeDirty: () => becameDirty,
      dispose: () => {
        subscription.dispose();
      },
    };
  }

  private async runFormatterProcess(
    processRunner: ProcessRunner,
    executablePath: string,
    args: readonly string[],
    cwd?: string,
  ): Promise<ProcessResult> {
    const maximumAttempts = 3;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        const result = await processRunner(executablePath, args, { cwd });
        if (result.exitCode === 0 || attempt === maximumAttempts || !this.isTransientFileAccessFailure(result)) {
          return result;
        }

        this.logger.warn(
          `Retrying dfixxer for ${args[1] ?? ""} after a transient file access failure (${attempt}/${maximumAttempts}).`,
        );
      } catch (error: unknown) {
        if (attempt === maximumAttempts || !this.isTransientFileAccessError(error)) {
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Retrying dfixxer for ${args[1] ?? ""} after a transient file access failure (${attempt}/${maximumAttempts}): ${errorMessage}`,
        );
      }

      await this.delay(75 * attempt);
    }

    throw new Error("Transient formatter retry loop exited unexpectedly.");
  }

  private isTransientFileAccessFailure(processResult: ProcessResult): boolean {
    return this.matchesTransientFileAccessPattern(`${processResult.stdout}\n${processResult.stderr}`);
  }

  private isTransientFileAccessError(error: unknown): boolean {
    if (typeof error === "object" && error !== null && "code" in error) {
      const errorCode = (error as { code?: unknown }).code;
      if (typeof errorCode === "string" && ["EACCES", "EBUSY", "EPERM"].includes(errorCode)) {
        return true;
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return this.matchesTransientFileAccessPattern(errorMessage);
  }

  private matchesTransientFileAccessPattern(value: string): boolean {
    return /\b(?:EACCES|EBUSY|EPERM)\b|resource busy or locked|being used by another process/iu.test(value);
  }

  private async reloadDocument(document: vscode.TextDocument): Promise<void> {
    const previouslyActiveEditor = vscode.window.activeTextEditor;
    const shouldRestorePreviousEditor =
      previouslyActiveEditor && previouslyActiveEditor.document.uri.toString() !== document.uri.toString();

    try {
      await vscode.window.showTextDocument(document, { preserveFocus: false, preview: false });
      await vscode.commands.executeCommand("workbench.action.files.revert");
      this.logger.info(`Reloaded ${document.uri.fsPath} after a successful dfixxer update.`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not reload ${document.uri.fsPath} after formatting: ${errorMessage}`);
    } finally {
      if (shouldRestorePreviousEditor) {
        try {
          await vscode.window.showTextDocument(previouslyActiveEditor.document, {
            preserveFocus: false,
            preview: false,
            viewColumn: previouslyActiveEditor.viewColumn,
          });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Could not restore ${previouslyActiveEditor.document.uri.fsPath}: ${errorMessage}`);
        }
      }
    }
  }

  private getPostSaveDelayMilliseconds(): number {
    return this.getRuntimePlatform().platform === "win32" ? 125 : 50;
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
