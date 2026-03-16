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
}

suite("Auto Format On Save", () => {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const pascalFilePath = workspaceRoot ? path.join(workspaceRoot, "format-on-save-test.pas") : "";
  const objectPascalFilePath = workspaceRoot ? path.join(workspaceRoot, "format-on-save-test.dpr") : "";
  const textFilePath = workspaceRoot ? path.join(workspaceRoot, "format-on-save-test.txt") : "";
  const manualFixFilePath = workspaceRoot ? path.join(workspaceRoot, "format-on-save-manual-test.pas") : "";
  const failureFilePath = workspaceRoot ? path.join(workspaceRoot, "format-on-save-failure-test.pas") : "";
  const fakeExecutablePath = workspaceRoot ? path.join(workspaceRoot, "fake-dfixxer.exe") : "";

  suiteSetup(async () => {
    assert.ok(workspaceRoot);
    await fs.writeFile(fakeExecutablePath, "stub executable", "utf8");
  });

  setup(async () => {
    const api = await getExtensionApi();
    api.resetTestHooks();
    await updateSetting("configurationFile", "");
    await updateSetting("executablePath", fakeExecutablePath);
    await updateSetting("formatOnSave", true);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  teardown(async () => {
    await fs.rm(pascalFilePath, { force: true });
    await fs.rm(objectPascalFilePath, { force: true });
    await fs.rm(textFilePath, { force: true });
    await fs.rm(manualFixFilePath, { force: true });
    await fs.rm(failureFilePath, { force: true });
  });

  test("formats Pascal and Object Pascal files after save, but skips other languages", async () => {
    const api = await getExtensionApi();
    const invocations: string[] = [];

    api.setTestHooks({
      processRunner: (_executablePath, args) => {
        invocations.push(args[1] ?? "");
        return fs.writeFile(args[1] ?? "", "formatted on save", "utf8").then(() => ({
          exitCode: 0,
          stderr: "",
          stdout: "",
        }));
      },
    });

    await fs.writeFile(pascalFilePath, "pascal source", "utf8");
    const pascalEditor = await openDocument(pascalFilePath);
    await pascalEditor.edit((editBuilder) => {
      const fullRange = new vscode.Range(
        pascalEditor.document.positionAt(0),
        pascalEditor.document.positionAt(pascalEditor.document.getText().length),
      );
      editBuilder.replace(
        fullRange,
        "pascal source updated",
      );
    });
    await pascalEditor.document.save();
    await waitForText(pascalEditor.document, "formatted on save");

    await fs.writeFile(objectPascalFilePath, "program Test;", "utf8");
    const objectPascalEditor = await openDocument(objectPascalFilePath);
    await objectPascalEditor.edit((editBuilder) => {
      const fullRange = new vscode.Range(
        objectPascalEditor.document.positionAt(0),
        objectPascalEditor.document.positionAt(objectPascalEditor.document.getText().length),
      );
      editBuilder.replace(
        fullRange,
        "program UpdatedTest;",
      );
    });
    await objectPascalEditor.document.save();
    await waitForText(objectPascalEditor.document, "formatted on save");

    await fs.writeFile(textFilePath, "plain text", "utf8");
    const textEditor = await openDocument(textFilePath);
    await textEditor.edit((editBuilder) => {
      const fullRange = new vscode.Range(
        textEditor.document.positionAt(0),
        textEditor.document.positionAt(textEditor.document.getText().length),
      );
      editBuilder.replace(
        fullRange,
        "plain text updated",
      );
    });
    await textEditor.document.save();

    assert.deepEqual(invocations, [pascalFilePath, objectPascalFilePath]);
  });

  test("skips non-file documents in the save handler", async () => {
    const api = await getExtensionApi();
    let invoked = false;

    api.setTestHooks({
      processRunner: () => {
        invoked = true;
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "",
        });
      },
    });

    const untitledDocument = await vscode.workspace.openTextDocument({
      content: "program Untitled;",
      language: "pascal",
    });

    await api.invokeDidSaveForTest(untitledDocument);

    assert.equal(invoked, false);
  });

  test("does not loop when manual fix saves a dirty file while format-on-save is enabled", async () => {
    const api = await getExtensionApi();
    let invocationCount = 0;

    api.setTestHooks({
      processRunner: (_executablePath, args) => {
        invocationCount += 1;
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            fs.writeFile(args[1] ?? "", "formatted manually", "utf8")
              .then(() => {
                resolve({
                  exitCode: 0,
                  stderr: "",
                  stdout: "",
                });
              })
              .catch(reject);
          }, 50);
        });
      },
    });

    await fs.writeFile(manualFixFilePath, "before manual fix", "utf8");
    const editor = await openDocument(manualFixFilePath);
    await editor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length)),
        "dirty manual fix",
      );
    });

    await vscode.commands.executeCommand(commandIds.fixCurrentFile);
    await waitForText(editor.document, "formatted manually");

    assert.equal(invocationCount, 1);
  });

  test("does not retry repeatedly after a save-triggered failure", async () => {
    const api = await getExtensionApi();
    const errors: string[] = [];
    let invocationCount = 0;

    api.setTestHooks({
      processRunner: () => {
        invocationCount += 1;
        return Promise.resolve({
          exitCode: 1,
          stderr: "failed on save",
          stdout: "",
        });
      },
      showErrorMessage: (message) => {
        errors.push(message);
        return Promise.resolve(undefined);
      },
    });

    await fs.writeFile(failureFilePath, "program Failure;", "utf8");
    const editor = await openDocument(failureFilePath);
    await editor.edit((editBuilder) => {
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length),
      );
      editBuilder.replace(
        fullRange,
        "program FailureUpdated;",
      );
    });
    await editor.document.save();
    await waitForCondition(() => invocationCount === 1 || errors.length > 0);

    assert.equal(invocationCount, 1);
    assert.deepEqual(errors, [
      "dfixxer failed to format format-on-save-failure-test.pas. See the dfixxer output channel for details.",
    ]);
  });
});
