import * as assert from "node:assert/strict";
import * as path from "node:path";
import { resolveExecutablePath } from "../../executableResolution";
import { createLogger, OutputChannelLike } from "../../logger";
import { getManagedExecutableLayout } from "../../managedPaths";
import { normalizeSettings, resolveSettingPath } from "../../settings";

class MemoryChannel implements OutputChannelLike {
  public readonly lines: string[] = [];

  public appendLine(value: string): void {
    this.lines.push(value);
  }
}

const workspaceFolderPath = path.resolve("repo");
const overrideExecutablePath = path.join(workspaceFolderPath, "tools", "dfixxer.exe");
const managedStoragePath = path.resolve("storage");

describe("settings resolution", () => {
  it("normalizes empty settings to documented defaults", () => {
    assert.deepEqual(normalizeSettings({}), {
      configurationFile: "",
      executablePath: "",
      formatOnSave: false,
    });
  });

  it("expands workspace-relative settings", () => {
    assert.deepEqual(resolveSettingPath("tools/dfixxer.exe", { workspaceFolderPath }), {
      kind: "workspaceRelative",
      input: "tools/dfixxer.exe",
      resolvedPath: overrideExecutablePath,
      workspaceFolderPath,
    });
  });

  it("preserves unresolved relative settings when no workspace is available", () => {
    assert.deepEqual(resolveSettingPath("tools/dfixxer.exe"), {
      kind: "unresolvedRelative",
      input: "tools/dfixxer.exe",
    });
  });
});

describe("managed executable layout", () => {
  it("uses a platform-specific bin folder and metadata file", () => {
    const installDirectory = path.join(managedStoragePath, "bin", "win32-x64");

    assert.deepEqual(
      getManagedExecutableLayout(managedStoragePath, { platform: "win32", arch: "x64" }),
      {
        executableName: "dfixxer.exe",
        executablePath: path.join(installDirectory, "dfixxer.exe"),
        installDirectory,
        metadataPath: path.join(installDirectory, "metadata.json"),
        platformArch: "win32-x64",
      },
    );
  });
});

describe("resolveExecutablePath", () => {
  it("prefers an existing override executable path", () => {
    const channel = new MemoryChannel();
    const resolution = resolveExecutablePath({
      executableSetting: "tools/dfixxer.exe",
      managed: getManagedExecutableLayout(managedStoragePath, { platform: "win32", arch: "x64" }),
      logger: createLogger(channel, () => new Date("2026-03-16T12:00:00.000Z")),
      pathExists: (targetPath) => targetPath === overrideExecutablePath,
      workspaceFolderPath,
    });

    assert.deepEqual(resolution, {
      kind: "override",
      executablePath: overrideExecutablePath,
      source: "setting",
      setting: {
        kind: "workspaceRelative",
        input: "tools/dfixxer.exe",
        resolvedPath: overrideExecutablePath,
        workspaceFolderPath,
      },
    });
    assert.match(channel.lines[0], /Resolved executable from dfixxer\.executablePath/u);
  });

  it("falls back to the managed executable path", () => {
    const channel = new MemoryChannel();
    const managed = getManagedExecutableLayout(managedStoragePath, { platform: "win32", arch: "x64" });
    const resolution = resolveExecutablePath({
      executableSetting: "",
      managed,
      logger: createLogger(channel, () => new Date("2026-03-16T12:00:00.000Z")),
      pathExists: (targetPath) => targetPath === managed.executablePath,
    });

    assert.deepEqual(resolution, {
      kind: "managed",
      executablePath: managed.executablePath,
      source: "managed",
      managed,
    });
    assert.match(channel.lines[0], /Resolved executable from managed install/u);
  });

  it("returns a deterministic missing state when no executable is available", () => {
    const channel = new MemoryChannel();
    const managed = getManagedExecutableLayout(managedStoragePath, { platform: "win32", arch: "x64" });
    const resolution = resolveExecutablePath({
      executableSetting: "",
      managed,
      logger: createLogger(channel, () => new Date("2026-03-16T12:00:00.000Z")),
      pathExists: () => false,
    });

    assert.deepEqual(resolution, {
      kind: "missing",
      attemptedPath: managed.executablePath,
      reason: "managed-not-installed",
      source: "managed",
    });
    assert.match(channel.lines[0], /Managed executable is not installed/u);
  });
});
