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

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.equal(condition(), true);
}

suite("Fix Current File", () => {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const pascalFilePath = workspaceRoot ? path.join(workspaceRoot, "fix-current-file-test.pas") : "";
  const secondaryPascalFilePath = workspaceRoot ? path.join(workspaceRoot, "fix-current-file-secondary-test.pas") : "";
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
    await fs.rm(secondaryPascalFilePath, { force: true });
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

  test("keeps fresh in-editor edits when the formatted document changes again before completion", async () => {
    const api = await getExtensionApi();
    let releaseFormatter: (() => void) | undefined;

    api.setTestHooks({
      processRunner: (_executablePath, args) =>
        new Promise((resolve, reject) => {
          releaseFormatter = () => {
            fs.writeFile(args[1] ?? "", "formatted text", "utf8")
              .then(() => resolve({ exitCode: 0, stderr: "", stdout: "" }))
              .catch(reject);
          };
        }),
    });

    await fs.writeFile(pascalFilePath, "original text", "utf8");
    const editor = await openDocument(pascalFilePath);

    const fixPromise = vscode.commands.executeCommand(commandIds.fixCurrentFile);
    await waitForCondition(() => releaseFormatter !== undefined);

    await editor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)),
        "second draft",
      );
    });

    assert.ok(releaseFormatter);
    releaseFormatter();
    await fixPromise;

    assert.equal(editor.document.getText(), "second draft");
    assert.equal(editor.document.isDirty, true);
    assert.equal(await fs.readFile(pascalFilePath, "utf8"), "formatted text");
  });

  test("reloads only the formatted document when the active editor changed mid-run", async () => {
    const api = await getExtensionApi();
    let releaseFormatter: (() => void) | undefined;

    api.setTestHooks({
      processRunner: (_executablePath, args) =>
        new Promise((resolve, reject) => {
          releaseFormatter = () => {
            fs.writeFile(args[1] ?? "", "formatted text", "utf8")
              .then(() => resolve({ exitCode: 0, stderr: "", stdout: "" }))
              .catch(reject);
          };
        }),
    });

    await fs.writeFile(pascalFilePath, "program Primary;", "utf8");
    await fs.writeFile(secondaryPascalFilePath, "program Secondary;", "utf8");
    const formattedEditor = await openDocument(pascalFilePath);
    const secondaryDocument = await vscode.workspace.openTextDocument(secondaryPascalFilePath);
    await vscode.window.showTextDocument(secondaryDocument);
    await vscode.window.showTextDocument(formattedEditor.document);

    const fixPromise = vscode.commands.executeCommand(commandIds.fixCurrentFile);
    await waitForCondition(() => releaseFormatter !== undefined);

    const secondaryEditor = await vscode.window.showTextDocument(secondaryDocument);
    await secondaryEditor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(
          secondaryEditor.document.positionAt(0),
          secondaryEditor.document.positionAt(secondaryEditor.document.getText().length),
        ),
        "program SecondaryDirty;",
      );
    });

    assert.ok(releaseFormatter);
    releaseFormatter();
    await fixPromise;

    await waitForText(formattedEditor.document, "formatted text");
    assert.equal(secondaryEditor.document.getText(), "program SecondaryDirty;");
    assert.equal(secondaryEditor.document.isDirty, true);
  });
});
