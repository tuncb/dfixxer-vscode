import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import extractZip from "extract-zip";
import * as tar from "tar";
import { Logger } from "./logger";
import { ManagedExecutableLayout } from "./managedPaths";
import { ProcessResult, ProcessRunner, execFileProcessRunner } from "./processRunner";
import { CompatibleReleaseAsset } from "./releaseClient";

export interface ManagedInstallMetadata {
  assetName: string;
  releaseTag: string;
}

export interface InstallManagedExecutableOptions {
  archivePath: string;
  asset: CompatibleReleaseAsset;
  logger: Logger;
  managed: ManagedExecutableLayout;
  processRunner?: ProcessRunner;
  tempRoot?: string;
}

export interface DownloadAndInstallManagedExecutableOptions {
  asset: CompatibleReleaseAsset;
  fetchImpl?: typeof fetch;
  logger: Logger;
  managed: ManagedExecutableLayout;
  processRunner?: ProcessRunner;
  tempRoot?: string;
}

export interface ManagedInstallResult {
  executablePath: string;
  metadata: ManagedInstallMetadata;
}

export async function downloadAndInstallManagedExecutable(
  options: DownloadAndInstallManagedExecutableOptions,
): Promise<ManagedInstallResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const workingRoot = await fs.mkdtemp(
    path.join(options.tempRoot ?? os.tmpdir(), "dfixxer-download-"),
  );
  const archivePath = path.join(workingRoot, options.asset.assetName);

  try {
    await downloadReleaseAsset(options.asset.downloadUrl, archivePath, fetchImpl, options.logger);

    return await installManagedExecutableFromArchive({
      archivePath,
      asset: options.asset,
      logger: options.logger,
      managed: options.managed,
      processRunner: options.processRunner,
      tempRoot: options.tempRoot,
    });
  } finally {
    await fs.rm(workingRoot, { force: true, recursive: true });
  }
}

export async function installManagedExecutableFromArchive(
  options: InstallManagedExecutableOptions,
): Promise<ManagedInstallResult> {
  const workingRoot = await fs.mkdtemp(
    path.join(options.tempRoot ?? os.tmpdir(), "dfixxer-install-"),
  );
  const extractedDirectory = path.join(workingRoot, "extracted");
  const installParent = path.dirname(options.managed.installDirectory);
  const installBasename = path.basename(options.managed.installDirectory);
  const stageDirectory = path.join(installParent, `${installBasename}.incoming-${randomSuffix()}`);
  const backupDirectory = path.join(installParent, `${installBasename}.backup-${randomSuffix()}`);
  const stagedExecutablePath = path.join(stageDirectory, options.managed.executableName);
  const metadata: ManagedInstallMetadata = {
    assetName: options.asset.assetName,
    releaseTag: options.asset.releaseTag,
  };

  await fs.mkdir(extractedDirectory, { recursive: true });

  try {
    options.logger.info(`Extracting ${options.asset.assetName} from ${options.archivePath}.`);
    await extractArchive(options.archivePath, options.asset.archiveType, extractedDirectory);

    const extractedExecutablePath = path.join(extractedDirectory, options.managed.executableName);
    await ensurePathExists(
      extractedExecutablePath,
      `Extracted archive did not contain ${options.managed.executableName}.`,
    );

    if (options.managed.executableName === "dfixxer") {
      await fs.chmod(extractedExecutablePath, 0o755);
    }

    options.logger.info(`Validating extracted executable with "${options.managed.executableName} version".`);
    await validateManagedExecutable(extractedExecutablePath, options.processRunner);

    await fs.mkdir(installParent, { recursive: true });
    await fs.mkdir(stageDirectory, { recursive: true });
    await fs.copyFile(extractedExecutablePath, stagedExecutablePath);

    if (options.managed.executableName === "dfixxer") {
      await fs.chmod(stagedExecutablePath, 0o755);
    }

    await writeManagedInstallMetadata(path.join(stageDirectory, "metadata.json"), metadata);
    await swapInstallDirectory(options.managed.installDirectory, stageDirectory, backupDirectory);

    options.logger.info(
      `Installed managed dfixxer ${metadata.releaseTag} to ${options.managed.executablePath}.`,
    );

    return {
      executablePath: options.managed.executablePath,
      metadata,
    };
  } finally {
    await fs.rm(stageDirectory, { force: true, recursive: true });
    await fs.rm(backupDirectory, { force: true, recursive: true });
    await fs.rm(workingRoot, { force: true, recursive: true });
  }
}

export async function readManagedInstallMetadata(
  metadataPath: string,
): Promise<ManagedInstallMetadata | undefined> {
  try {
    const rawMetadata = await fs.readFile(metadataPath, "utf8");
    return JSON.parse(rawMetadata) as ManagedInstallMetadata;
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function validateManagedExecutable(
  executablePath: string,
  processRunner: ProcessRunner = execFileProcessRunner,
): Promise<ProcessResult> {
  const result = await processRunner(executablePath, ["version"]);

  if (result.exitCode !== 0) {
    throw new Error(
      `Executable validation failed with exit code ${result.exitCode}. stdout: ${result.stdout} stderr: ${result.stderr}`,
    );
  }

  return result;
}

async function downloadReleaseAsset(
  downloadUrl: string,
  archivePath: string,
  fetchImpl: typeof fetch,
  logger: Logger,
): Promise<void> {
  logger.info(`Downloading ${downloadUrl}.`);
  const response = await fetchImpl(downloadUrl, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "dfixxer-vscode",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed with ${response.status} ${response.statusText}.`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
}

async function extractArchive(
  archivePath: string,
  archiveType: CompatibleReleaseAsset["archiveType"],
  destinationDirectory: string,
): Promise<void> {
  if (archiveType === "zip") {
    await extractZip(archivePath, { dir: destinationDirectory });
    return;
  }

  await tar.x({
    cwd: destinationDirectory,
    file: archivePath,
    gzip: true,
  });
}

async function swapInstallDirectory(
  installDirectory: string,
  stageDirectory: string,
  backupDirectory: string,
): Promise<void> {
  const installExists = await pathExists(installDirectory);

  try {
    if (installExists) {
      await fs.rename(installDirectory, backupDirectory);
    }

    await fs.rename(stageDirectory, installDirectory);
  } catch (error: unknown) {
    if (!(await pathExists(installDirectory)) && installExists && (await pathExists(backupDirectory))) {
      await fs.rename(backupDirectory, installDirectory);
    }

    throw error;
  } finally {
    if (await pathExists(backupDirectory)) {
      await fs.rm(backupDirectory, { force: true, recursive: true });
    }
  }
}

async function writeManagedInstallMetadata(
  metadataPath: string,
  metadata: ManagedInstallMetadata,
): Promise<void> {
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}

async function ensurePathExists(targetPath: string, message: string): Promise<void> {
  await fs.access(targetPath).catch((error: unknown) => {
    throw new Error(`${message} (${targetPath})`, { cause: error });
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
