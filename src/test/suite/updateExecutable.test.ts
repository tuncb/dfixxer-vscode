import * as assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { commandIds, extensionName, managedDfixxerReleaseTag } from "../../constants";
import { ExtensionApi } from "../../extensionController";
import { RuntimePlatform } from "../../managedPaths";
import { createTarGzArchive, createZipArchive } from "../archiveHelpers";

type RuntimeFixture = {
  archiveType: "tar.gz" | "zip";
  assetName: string;
  executableName: string;
};

async function getExtensionApi(): Promise<ExtensionApi> {
  const extension = vscode.extensions.getExtension("tuncb.dfixxer-vscode");
  assert.ok(extension);
  return (await extension.activate()) as ExtensionApi;
}

async function updateSetting<T>(key: string, value: T): Promise<void> {
  await vscode.workspace.getConfiguration(extensionName).update(key, value, vscode.ConfigurationTarget.Workspace);
}

async function buildArchiveBytes(archivePath: string, fixture: RuntimeFixture): Promise<Uint8Array> {
  if (fixture.archiveType === "zip") {
    await createZipArchive(archivePath, {
      [fixture.executableName]: "managed binary",
    });
  } else {
    await createTarGzArchive(archivePath, {
      [fixture.executableName]: "managed binary",
    });
  }

  return fs.readFile(archivePath);
}

function resolveFetchUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function getRuntimeFixture(runtimePlatform: RuntimePlatform): RuntimeFixture {
  switch (runtimePlatform.platform) {
    case "win32":
      return {
        archiveType: "zip",
        assetName: `dfixxer-windows-x86_64-${managedDfixxerReleaseTag}.zip`,
        executableName: "dfixxer.exe",
      };
    case "linux":
      return {
        archiveType: "tar.gz",
        assetName: `dfixxer-linux-x86_64-${managedDfixxerReleaseTag}.tar.gz`,
        executableName: "dfixxer",
      };
    default:
      return {
        archiveType: "tar.gz",
        assetName:
          runtimePlatform.arch === "arm64"
            ? `dfixxer-macos-arm64-${managedDfixxerReleaseTag}.tar.gz`
            : `dfixxer-macos-x86_64-${managedDfixxerReleaseTag}.tar.gz`,
        executableName: "dfixxer",
      };
  }
}

suite("Update dfixxer", () => {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const fakeOverridePath = workspaceRoot ? path.join(workspaceRoot, "override-dfixxer.exe") : "";
  const pascalFilePath = workspaceRoot ? path.join(workspaceRoot, "first-use-bootstrap-test.pas") : "";
  const simulatedRuntimePlatform: RuntimePlatform = {
    arch: process.arch,
    platform: process.platform,
  };
  const runtimeFixture = getRuntimeFixture(simulatedRuntimePlatform);

  suiteSetup(async () => {
    assert.ok(workspaceRoot);
    await fs.writeFile(fakeOverridePath, "override binary", "utf8");
  });

  setup(async () => {
    const api = await getExtensionApi();
    api.resetTestHooks();
    await api.clearManagedInstallForTest();
    await updateSetting("configurationFile", "");
    await updateSetting("executablePath", "");
    await updateSetting("formatOnSave", false);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  teardown(async () => {
    await fs.rm(pascalFilePath, { force: true });
  });

  test("prompts to install on first use and then continues the fix flow", async () => {
    const api = await getExtensionApi();
    const errorMessages: string[] = [];
    const promptMessages: string[] = [];
    const requestedUrls: string[] = [];
    const tempArchivePath = path.join(workspaceRoot ?? "", runtimeFixture.assetName);
    const archiveBytes = await buildArchiveBytes(tempArchivePath, runtimeFixture);
    const processCalls: string[][] = [];

    api.setTestHooks({
      fetchImpl: (input) => {
        const url = resolveFetchUrl(input);
        requestedUrls.push(url);

        if (url.includes(`/repos/tuncb/dfixxer/releases/tags/${managedDfixxerReleaseTag}`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                assets: [
                  {
                    browser_download_url: "https://example.invalid/download/dfixxer",
                    content_type: runtimeFixture.archiveType === "zip" ? "application/zip" : "application/gzip",
                    name: runtimeFixture.assetName,
                    size: archiveBytes.length,
                  },
                ],
                draft: false,
                name: `Release ${managedDfixxerReleaseTag}`,
                prerelease: false,
                published_at: "2026-03-16T12:00:00Z",
                tag_name: managedDfixxerReleaseTag,
              }),
              { status: 200 },
            ),
          );
        }

        return Promise.resolve(
          new Response(new Uint8Array(archiveBytes), {
            status: 200,
          }),
        );
      },
      processRunner: (_executablePath, args) => {
        processCalls.push([...args]);
        if (args[0] === "version") {
          return Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: `dfixxer ${managedDfixxerReleaseTag}`,
          });
        }

        return fs.writeFile(args[1] ?? "", "formatted after bootstrap", "utf8").then(() => ({
          exitCode: 0,
          stderr: "",
          stdout: "",
        }));
      },
      runtimePlatform: simulatedRuntimePlatform,
      showErrorMessage: (message) => {
        errorMessages.push(message);
        return Promise.resolve(undefined);
      },
      showInformationMessage: (message, ...items) => {
        promptMessages.push(message);
        if (message.includes("Install the managed executable now?")) {
          return Promise.resolve(items[0]);
        }

        return Promise.resolve(undefined);
      },
    });

    await fs.writeFile(pascalFilePath, "program Bootstrap;", "utf8");
    const document = await vscode.workspace.openTextDocument(pascalFilePath);
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        "program BootstrapUpdated;",
      );
    });

    await vscode.commands.executeCommand(commandIds.fixCurrentFile);

    assert.deepEqual(processCalls.map((call) => call[0]), ["version", "update"]);
    assert.deepEqual(errorMessages, []);
    assert.match(promptMessages[0] ?? "", /Install the managed executable now/u);
    assert.equal(await fs.readFile(pascalFilePath, "utf8"), "formatted after bootstrap");
    assert.equal(
      requestedUrls.some((url) => url.includes("https://example.invalid/download/dfixxer")),
      true,
    );
    assert.equal(
      requestedUrls.some((url) => url.includes(`/repos/tuncb/dfixxer/releases/tags/${managedDfixxerReleaseTag}`)),
      true,
    );

    await fs.rm(tempArchivePath, { force: true });
  });

  test("updates the managed binary, warns when an override is set, and returns no-op when already current", async () => {
    const api = await getExtensionApi();
    const errorMessages: string[] = [];
    const tempArchivePath = path.join(workspaceRoot ?? "", runtimeFixture.assetName);
    const archiveBytes = await buildArchiveBytes(tempArchivePath, runtimeFixture);
    const infoMessages: string[] = [];
    const warningMessages: string[] = [];
    let downloadCount = 0;

    await updateSetting("executablePath", fakeOverridePath);

    api.setTestHooks({
      fetchImpl: (input) => {
        const url = resolveFetchUrl(input);

        if (url.includes(`/repos/tuncb/dfixxer/releases/tags/${managedDfixxerReleaseTag}`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                assets: [
                  {
                    browser_download_url: "https://example.invalid/download/dfixxer",
                    content_type: runtimeFixture.archiveType === "zip" ? "application/zip" : "application/gzip",
                    name: runtimeFixture.assetName,
                    size: archiveBytes.length,
                  },
                ],
                draft: false,
                name: `Release ${managedDfixxerReleaseTag}`,
                prerelease: false,
                published_at: "2026-03-16T12:00:00Z",
                tag_name: managedDfixxerReleaseTag,
              }),
              { status: 200 },
            ),
          );
        }

        downloadCount += 1;
        return Promise.resolve(
          new Response(new Uint8Array(archiveBytes), {
            status: 200,
          }),
        );
      },
      processRunner: () =>
        Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: `dfixxer ${managedDfixxerReleaseTag}`,
        }),
      runtimePlatform: simulatedRuntimePlatform,
      showErrorMessage: (message) => {
        errorMessages.push(message);
        return Promise.resolve(undefined);
      },
      showInformationMessage: (message) => {
        infoMessages.push(message);
        return Promise.resolve(undefined);
      },
      showWarningMessage: (message) => {
        warningMessages.push(message);
        return Promise.resolve(undefined);
      },
    });

    await vscode.commands.executeCommand(commandIds.updateExecutable);
    await vscode.commands.executeCommand(commandIds.updateExecutable);

    assert.equal(await fs.readFile(fakeOverridePath, "utf8"), "override binary");
    assert.equal(downloadCount, 1);
    assert.deepEqual(errorMessages, []);
    assert.deepEqual(infoMessages, [
      `Updated managed dfixxer to ${managedDfixxerReleaseTag}.`,
      `Managed dfixxer ${managedDfixxerReleaseTag} is already up to date.`,
    ]);
    assert.deepEqual(warningMessages, [
      "dfixxer.executablePath is set, so the configured override remains authoritative over the managed executable.",
      "dfixxer.executablePath is set, so the configured override remains authoritative over the managed executable.",
    ]);

    await fs.rm(tempArchivePath, { force: true });
  });
});
