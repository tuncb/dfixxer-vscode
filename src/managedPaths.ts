import * as path from "node:path";

export interface RuntimePlatform {
  platform: NodeJS.Platform;
  arch: string;
}

export interface ManagedExecutableLayout {
  executableName: string;
  executablePath: string;
  installDirectory: string;
  metadataPath: string;
  platformArch: string;
}

export function detectRuntimePlatform(): RuntimePlatform {
  return {
    platform: process.platform,
    arch: process.arch,
  };
}

export function getManagedExecutableLayout(
  globalStoragePath: string,
  runtime: RuntimePlatform = detectRuntimePlatform(),
): ManagedExecutableLayout {
  const platformArch = `${runtime.platform}-${runtime.arch}`;
  const installDirectory = path.join(globalStoragePath, "bin", platformArch);
  const executableName = runtime.platform === "win32" ? "dfixxer.exe" : "dfixxer";

  return {
    executableName,
    executablePath: path.join(installDirectory, executableName),
    installDirectory,
    metadataPath: path.join(installDirectory, "metadata.json"),
    platformArch,
  };
}
