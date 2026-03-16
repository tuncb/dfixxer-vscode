import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { commandIds, extensionName } from "./constants";
import { DocumentRunGuard } from "./documentRunGuard";
import { isFileBackedDocument, isPascalDocument } from "./documentUtils";
import { resolveExecutablePath } from "./executableResolution";
import { createLogger, OutputChannelLike } from "./logger";
import { getManagedExecutableLayout } from "./managedPaths";
import { ProcessRunner, execFileProcessRunner } from "./processRunner";
import { getDocumentSettings, getWorkspaceFolderPath, resolveConfigurationPath } from "./vscodeSettings";

interface ExtensionTestHooks {
  processRunner?: ProcessRunner;
  showErrorMessage?: (message: string) => Thenable<unknown>;
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
      vscode.commands.registerCommand(commandIds.createConfig, () => undefined),
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
}
