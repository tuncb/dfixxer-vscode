import * as assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { commandIds, extensionName } from "../../constants";
import { ExtensionApi } from "../../extensionController";

async function getExtensionApi(): Promise<ExtensionApi> {
  const extension = vscode.extensions.getExtension("tuncb.dfixxer-vscode");
  assert.ok(extension);
  return (await extension.activate()) as ExtensionApi;
}

async function openDocument(filePath: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(filePath);
  return vscode.window.showTextDocument(document);
}

async function openDocumentBeside(filePath: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(filePath);
  return vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

async function updateSetting<T>(key: string, value: T): Promise<void> {
  await vscode.workspace.getConfiguration(extensionName).update(key, value, vscode.ConfigurationTarget.Workspace);
}

async function waitForText(document: vscode.TextDocument, expectedText: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (document.getText() === expectedText) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(document.getText(), expectedText);
}

async function waitForDirtyText(document: vscode.TextDocument, expectedText: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (document.isDirty && document.getText() === expectedText) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(document.isDirty, true);
  assert.equal(document.getText(), expectedText);
}

suite("Fix Current File", () => {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const pascalFilePath = workspaceRoot ? path.join(workspaceRoot, "fix-current-file-test.pas") : "";
  const alternatePascalFilePath = workspaceRoot ? path.join(workspaceRoot, "fix-current-file-alternate-test.pas") : "";
  const textFilePath = workspaceRoot ? path.join(workspaceRoot, "fix-current-file-test.txt") : "";
  const fakeExecutablePath = workspaceRoot ? path.join(workspaceRoot, "fake-dfixxer.exe") : "";

  suiteSetup(async () => {
    assert.ok(workspaceRoot);
    await fs.writeFile(fakeExecutablePath, "stub executable", "utf8");
  });

  setup(async function () {
    const api = await getExtensionApi();
    api.resetTestHooks();
    await updateSetting("configurationFile", "");
    await updateSetting("executablePath", fakeExecutablePath);
    await updateSetting("formatOnSave", false);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  teardown(async () => {
    await fs.rm(pascalFilePath, { force: true });
    await fs.rm(alternatePascalFilePath, { force: true });
    await fs.rm(textFilePath, { force: true });
  });

  test("rejects non-Pascal files cleanly", async () => {
    const api = await getExtensionApi();
    const errors: string[] = [];
    api.setTestHooks({
      showErrorMessage: (message) => {
        errors.push(message);
        return Promise.resolve(undefined);
      },
    });

    await fs.writeFile(textFilePath, "plain text", "utf8");
    await openDocument(textFilePath);
    await vscode.commands.executeCommand(commandIds.fixCurrentFile);

    assert.deepEqual(errors, ["dfixxer can only format Pascal files."]);
  });

  test("saves dirty Pascal files once, omits --config when unset, and reloads from disk", async () => {
    const api = await getExtensionApi();
    const invocations: Array<{ args: readonly string[] }> = [];

    api.setTestHooks({
      processRunner: async (_executablePath, args) => {
        invocations.push({ args });
        assert.equal(args.includes("--config"), false);
        assert.equal(await fs.readFile(pascalFilePath, "utf8"), "dirty text");
        await fs.writeFile(pascalFilePath, "formatted text", "utf8");
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    });

    await fs.writeFile(pascalFilePath, "original text", "utf8");
    const editor = await openDocument(pascalFilePath);
    await editor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)),
        "dirty text",
      );
    });

    assert.equal(editor.document.isDirty, true);

    await vscode.commands.executeCommand(commandIds.fixCurrentFile);
    await waitForText(editor.document, "formatted text");

    assert.equal(invocations.length, 1);
    assert.equal(editor.document.isDirty, false);
  });

  test("logs stdout and stderr on process failure and shows a user-facing error", async () => {
    const api = await getExtensionApi();
    const errors: string[] = [];

    api.setTestHooks({
      processRunner: () =>
        Promise.resolve({
          exitCode: 1,
          stderr: "stderr output",
          stdout: "stdout output",
        }),
      showErrorMessage: (message) => {
        errors.push(message);
        return Promise.resolve(undefined);
      },
    });

    await fs.writeFile(pascalFilePath, "program Test; begin end.", "utf8");
    await openDocument(pascalFilePath);
    await vscode.commands.executeCommand(commandIds.fixCurrentFile);

    assert.deepEqual(errors, [
      "dfixxer failed to format fix-current-file-test.pas. See the dfixxer output channel for details.",
    ]);
    const logText = api.getLogLines().join("\n");
    assert.match(logText, /stdout: stdout output/u);
    assert.match(logText, /stderr: stderr output/u);
  });

  test("reloads the formatted file without reverting the active alternate editor", async () => {
    const api = await getExtensionApi();
    let releaseFormatter: (() => void) | undefined;

    api.setTestHooks({
      processRunner: async (_executablePath, args) => {
        await new Promise<void>((resolve) => {
          releaseFormatter = resolve;
        });
        await fs.writeFile(args[1] ?? "", "formatted text", "utf8");
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    });

    await fs.writeFile(pascalFilePath, "original text", "utf8");
    await fs.writeFile(alternatePascalFilePath, "alternate original", "utf8");

    const formattedEditor = await openDocument(pascalFilePath);
    const alternateEditor = await openDocumentBeside(alternatePascalFilePath);
    await vscode.window.showTextDocument(formattedEditor.document, {
      preview: false,
      preserveFocus: false,
      viewColumn: formattedEditor.viewColumn,
    });

    const fixPromise = vscode.commands.executeCommand(commandIds.fixCurrentFile);
    for (let attempt = 0; attempt < 20 && !releaseFormatter; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(releaseFormatter);

    await vscode.window.showTextDocument(alternateEditor.document, {
      preview: false,
      preserveFocus: false,
      viewColumn: alternateEditor.viewColumn,
    });
    await alternateEditor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(
          alternateEditor.document.positionAt(0),
          alternateEditor.document.positionAt(alternateEditor.document.getText().length),
        ),
        "alternate dirty",
      );
    });
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, alternatePascalFilePath);

    releaseFormatter();
    await fixPromise;
    await waitForText(formattedEditor.document, "formatted text");

    assert.equal(formattedEditor.document.isDirty, false);
    assert.equal(alternateEditor.document.getText(), "alternate dirty");
    assert.equal(alternateEditor.document.isDirty, true);
  });

  test("keeps newer edits and notifies the user when the document changes during formatting", async () => {
    const api = await getExtensionApi();
    const infos: string[] = [];
    let releaseFormatter: (() => void) | undefined;

    api.setTestHooks({
      processRunner: async (_executablePath, args) => {
        await new Promise<void>((resolve) => {
          releaseFormatter = resolve;
        });
        await fs.writeFile(args[1] ?? "", "formatted text", "utf8");
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      showInformationMessage: (message) => {
        infos.push(message);
        return Promise.resolve(undefined);
      },
    });

    await fs.writeFile(pascalFilePath, "original text", "utf8");
    const editor = await openDocument(pascalFilePath);

    const fixPromise = vscode.commands.executeCommand(commandIds.fixCurrentFile);
    for (let attempt = 0; attempt < 20 && !releaseFormatter; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(releaseFormatter);

    const applied = await editor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)),
        "newer unsaved text",
      );
    });
    assert.equal(applied, true);
    await waitForDirtyText(editor.document, "newer unsaved text");

    releaseFormatter();
    await fixPromise;

    assert.equal(editor.document.getText(), "newer unsaved text");
    assert.equal(editor.document.isDirty, true);
    assert.deepEqual(infos, [
      "dfixxer formatted fix-current-file-test.pas on disk, but the file changed while formatting was running. Your newer edits were kept. Save or run Fix Current File again to apply formatting to the latest content.",
    ]);
  });
});
