import * as assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { managedDfixxerReleaseTag } from "../../constants";
import { createLogger, OutputChannelLike } from "../../logger";
import {
  downloadAndInstallManagedExecutable,
  installManagedExecutableFromArchive,
  readManagedInstallMetadata,
} from "../../managedInstall";
import { getManagedExecutableLayout } from "../../managedPaths";
import { createTarGzArchive, createZipArchive } from "../archiveHelpers";

class MemoryChannel implements OutputChannelLike {
  public readonly lines: string[] = [];

  public appendLine(value: string): void {
    this.lines.push(value);
  }
}

describe("installManagedExecutableFromArchive", () => {
  it("installs a Windows zip archive and writes metadata after validation", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dfixxer-win-install-"));
    const archivePath = path.join(tempRoot, "dfixxer-windows-x86_64-v0.11.0.zip");
    const logger = createLogger(new MemoryChannel(), () => new Date("2026-03-16T12:00:00.000Z"));
    const managed = getManagedExecutableLayout(path.join(tempRoot, "storage"), {
      platform: "win32",
      arch: "x64",
    });

    try {
      await createZipArchive(archivePath, {
        "dfixxer.exe": "stub windows binary",
      });

      const result = await installManagedExecutableFromArchive({
        archivePath,
        asset: {
          archiveType: "zip",
          assetName: path.basename(archivePath),
          downloadUrl: "https://example.invalid/windows.zip",
          releaseName: "Release v0.11.0",
          releaseTag: "v0.11.0",
          size: 10,
        },
        logger,
        managed,
        processRunner: async (executablePath, args) => {
          assert.equal(args.join(" "), "version");
          assert.equal(await fs.readFile(executablePath, "utf8"), "stub windows binary");
          assert.equal(await readManagedInstallMetadata(managed.metadataPath), undefined);
          return { exitCode: 0, stderr: "", stdout: "dfixxer v0.11.0" };
        },
        tempRoot,
      });

      assert.equal(result.executablePath, managed.executablePath);
      assert.equal(await fs.readFile(managed.executablePath, "utf8"), "stub windows binary");
      assert.deepEqual(await readManagedInstallMetadata(managed.metadataPath), {
        assetName: "dfixxer-windows-x86_64-v0.11.0.zip",
        releaseTag: "v0.11.0",
      });
    } finally {
      await fs.rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("installs a Unix tarball and marks the binary executable", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dfixxer-unix-install-"));
    const archivePath = path.join(tempRoot, "dfixxer-linux-x86_64-v0.11.0.tar.gz");
    const logger = createLogger(new MemoryChannel(), () => new Date("2026-03-16T12:00:00.000Z"));
    const managed = getManagedExecutableLayout(path.join(tempRoot, "storage"), {
      platform: "linux",
      arch: "x64",
    });

    try {
      await createTarGzArchive(archivePath, {
        dfixxer: "stub unix binary",
      });

      await installManagedExecutableFromArchive({
        archivePath,
        asset: {
          archiveType: "tar.gz",
          assetName: path.basename(archivePath),
          downloadUrl: "https://example.invalid/linux.tar.gz",
          releaseName: "Release v0.11.0",
          releaseTag: "v0.11.0",
          size: 10,
        },
        logger,
        managed,
        processRunner: () =>
          Promise.resolve({ exitCode: 0, stderr: "", stdout: "dfixxer v0.11.0" }),
        tempRoot,
      });

      const executableStats = await fs.stat(managed.executablePath);
      if (process.platform === "win32") {
        assert.ok(executableStats.isFile());
      } else {
        assert.equal(executableStats.mode & 0o111, 0o111);
      }
    } finally {
      await fs.rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("preserves a previous managed install when validation fails", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dfixxer-install-rollback-"));
    const archivePath = path.join(tempRoot, `dfixxer-windows-x86_64-${managedDfixxerReleaseTag}.zip`);
    const logger = createLogger(new MemoryChannel(), () => new Date("2026-03-16T12:00:00.000Z"));
    const managed = getManagedExecutableLayout(path.join(tempRoot, "storage"), {
      platform: "win32",
      arch: "x64",
    });

    try {
      await fs.mkdir(managed.installDirectory, { recursive: true });
      await fs.writeFile(managed.executablePath, "old binary", "utf8");
      await fs.writeFile(
        managed.metadataPath,
        JSON.stringify({ assetName: "old.zip", releaseTag: "v0.10.0" }, null, 2),
        "utf8",
      );
      await createZipArchive(archivePath, {
        "dfixxer.exe": "new binary",
      });

      await assert.rejects(
        installManagedExecutableFromArchive({
          archivePath,
          asset: {
            archiveType: "zip",
            assetName: path.basename(archivePath),
            downloadUrl: "https://example.invalid/windows.zip",
            releaseName: `Release ${managedDfixxerReleaseTag}`,
            releaseTag: managedDfixxerReleaseTag,
            size: 10,
          },
          logger,
          managed,
          processRunner: () =>
            Promise.resolve({
              exitCode: 1,
              stderr: "validation failed",
              stdout: "",
            }),
          tempRoot,
        }),
      );

      assert.equal(await fs.readFile(managed.executablePath, "utf8"), "old binary");
      assert.deepEqual(await readManagedInstallMetadata(managed.metadataPath), {
        assetName: "old.zip",
        releaseTag: "v0.10.0",
      });
    } finally {
      await fs.rm(tempRoot, { force: true, recursive: true });
    }
  });
});

describe("downloadAndInstallManagedExecutable", () => {
  it("downloads the selected asset before installing it", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dfixxer-download-install-"));
    const archivePath = path.join(tempRoot, "fixture.zip");
    const logger = createLogger(new MemoryChannel(), () => new Date("2026-03-16T12:00:00.000Z"));
    const managed = getManagedExecutableLayout(path.join(tempRoot, "storage"), {
      platform: "win32",
      arch: "x64",
    });

    try {
      await createZipArchive(archivePath, {
        "dfixxer.exe": "downloaded binary",
      });
      const archiveBytes = await fs.readFile(archivePath);

      await downloadAndInstallManagedExecutable({
        asset: {
          archiveType: "zip",
          assetName: "dfixxer-windows-x86_64-v0.11.0.zip",
          downloadUrl: "https://example.invalid/windows.zip",
          releaseName: "Release v0.11.0",
          releaseTag: "v0.11.0",
          size: archiveBytes.length,
        },
        fetchImpl: () =>
          Promise.resolve(
            new Response(new Uint8Array(archiveBytes), {
              status: 200,
            }),
          ),
        logger,
        managed,
        processRunner: () =>
          Promise.resolve({ exitCode: 0, stderr: "", stdout: "dfixxer v0.11.0" }),
        tempRoot,
      });

      assert.equal(await fs.readFile(managed.executablePath, "utf8"), "downloaded binary");
    } finally {
      await fs.rm(tempRoot, { force: true, recursive: true });
    }
  });
});
