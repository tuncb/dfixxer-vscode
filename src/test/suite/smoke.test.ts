import * as assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { commandIds } from "../../constants";
import { createLogger, OutputChannelLike } from "../../logger";
import { installManagedExecutableFromArchive, readManagedInstallMetadata } from "../../managedInstall";
import { getManagedExecutableLayout } from "../../managedPaths";
import { createTarGzArchive, createZipArchive } from "../archiveHelpers";

class MemoryChannel implements OutputChannelLike {
  public readonly lines: string[] = [];

  public appendLine(value: string): void {
    this.lines.push(value);
  }
}

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

  test("installs a managed archive inside the extension host", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dfixxer-extension-install-"));
    const logger = createLogger(new MemoryChannel(), () => new Date("2026-03-16T12:00:00.000Z"));
    const runtime =
      process.platform === "win32"
        ? { archiveType: "zip" as const, executableName: "dfixxer.exe", platform: "win32" as const }
        : process.platform === "linux"
          ? { archiveType: "tar.gz" as const, executableName: "dfixxer", platform: "linux" as const }
          : { archiveType: "tar.gz" as const, executableName: "dfixxer", platform: "darwin" as const };
    const archivePath = path.join(
      tempRoot,
      runtime.archiveType === "zip"
        ? "dfixxer-windows-x86_64-v0.11.0.zip"
        : runtime.platform === "linux"
          ? "dfixxer-linux-x86_64-v0.11.0.tar.gz"
          : "dfixxer-macos-x86_64-v0.11.0.tar.gz",
    );
    const managed = getManagedExecutableLayout(path.join(tempRoot, "storage"), {
      arch: "x64",
      platform: runtime.platform,
    });

    try {
      if (runtime.archiveType === "zip") {
        await createZipArchive(archivePath, {
          [runtime.executableName]: "extension-host binary",
        });
      } else {
        await createTarGzArchive(archivePath, {
          [runtime.executableName]: "extension-host binary",
        });
      }

      await installManagedExecutableFromArchive({
        archivePath,
        asset: {
          archiveType: runtime.archiveType,
          assetName: path.basename(archivePath),
          downloadUrl: "https://example.invalid/archive",
          releaseName: "Release v0.11.0",
          releaseTag: "v0.11.0",
          size: 42,
        },
        logger,
        managed,
        processRunner: () =>
          Promise.resolve({ exitCode: 0, stderr: "", stdout: "dfixxer v0.11.0" }),
        tempRoot,
      });

      assert.deepEqual(await readManagedInstallMetadata(managed.metadataPath), {
        assetName: path.basename(archivePath),
        releaseTag: "v0.11.0",
      });
    } finally {
      await fs.rm(tempRoot, { force: true, recursive: true });
    }
  });
});
