import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { commandIds } from "../../constants";

suite("Extension Manifest", () => {
  test("registers the expected command ids after activation", async () => {
    const extension = vscode.extensions.getExtension("tuncb.dfixxer-vscode");
    assert.ok(extension);

    await extension.activate();

    const commandSet = new Set(await vscode.commands.getCommands(true));
    assert.ok(commandSet.has(commandIds.createConfig));
    assert.ok(commandSet.has(commandIds.fixCurrentFile));
    assert.ok(commandSet.has(commandIds.updateExecutable));
  });

  test("contributes the expected commands, settings, and activation events", () => {
    const extension = vscode.extensions.getExtension("tuncb.dfixxer-vscode");
    assert.ok(extension);

    const packageJson = extension.packageJSON as {
      activationEvents: string[];
      contributes: {
        commands: Array<{ command: string }>;
        configuration: {
          properties: Record<string, { default: boolean | string }>;
        };
      };
    };

    assert.deepEqual(packageJson.activationEvents, [
      "onLanguage:pascal",
      "onLanguage:objectpascal",
      "onCommand:dfixxer.createConfig",
      "onCommand:dfixxer.fixCurrentFile",
      "onCommand:dfixxer.updateExecutable",
    ]);

    assert.deepEqual(
      packageJson.contributes.commands.map((command) => command.command),
      [commandIds.createConfig, commandIds.fixCurrentFile, commandIds.updateExecutable],
    );

    assert.equal(packageJson.contributes.configuration.properties["dfixxer.configurationFile"].default, "");
    assert.equal(packageJson.contributes.configuration.properties["dfixxer.formatOnSave"].default, false);
    assert.equal(packageJson.contributes.configuration.properties["dfixxer.executablePath"].default, "");
  });
});
