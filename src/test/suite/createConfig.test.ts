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

async function updateSetting<T>(key: string, value: T): Promise<void> {
  await vscode.workspace.getConfiguration(extensionName).update(key, value, vscode.ConfigurationTarget.Workspace);
}

suite("Create Configuration File", () => {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const fakeExecutablePath = workspaceRoot ? path.join(workspaceRoot, "fake-dfixxer.exe") : "";
  const configFilePath = workspaceRoot ? path.join(workspaceRoot, "generated-dfixxer.toml") : "";

  suiteSetup(async () => {
    assert.ok(workspaceRoot);
    await fs.writeFile(fakeExecutablePath, "stub executable", "utf8");
  });

  setup(async () => {
    const api = await getExtensionApi();
    api.resetTestHooks();
    await updateSetting("executablePath", fakeExecutablePath);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  teardown(async () => {
    await fs.rm(configFilePath, { force: true });
  });

  test("runs init-config and opens the created file", async () => {
    const api = await getExtensionApi();
    const openedDocuments: string[] = [];

    api.setTestHooks({
      processRunner: (_executablePath, args) => {
        assert.deepEqual(args, ["init-config", configFilePath]);
        return fs.writeFile(configFilePath, "indentation = \"  \"", "utf8").then(() => ({
          exitCode: 0,
          stderr: "",
          stdout: "",
        }));
      },
      showSaveDialog: () => Promise.resolve(vscode.Uri.file(configFilePath)),
      showTextDocument: (document) => {
        openedDocuments.push(document.uri.fsPath);
        return Promise.resolve(undefined);
      },
    });

    await vscode.commands.executeCommand(commandIds.createConfig);

    assert.equal(await fs.readFile(configFilePath, "utf8"), "indentation = \"  \"");
    assert.deepEqual(openedDocuments, [configFilePath]);
  });

  test("requires explicit overwrite confirmation before replacing an existing target", async () => {
    const api = await getExtensionApi();
    const warnings: string[] = [];
    let invoked = false;

    await fs.writeFile(configFilePath, "existing = true", "utf8");

    api.setTestHooks({
      processRunner: () => {
        invoked = true;
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: "",
        });
      },
      showSaveDialog: () => Promise.resolve(vscode.Uri.file(configFilePath)),
      showWarningMessage: (message) => {
        warnings.push(message);
        return Promise.resolve("Cancel");
      },
    });

    await vscode.commands.executeCommand(commandIds.createConfig);

    assert.equal(invoked, false);
    assert.deepEqual(warnings, [
      "generated-dfixxer.toml already exists and dfixxer init-config will overwrite it.",
    ]);
    assert.equal(await fs.readFile(configFilePath, "utf8"), "existing = true");
  });
});
