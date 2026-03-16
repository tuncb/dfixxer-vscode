import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { ZipFile } from "yazl";

export async function createZipArchive(
  archivePath: string,
  files: Record<string, string>,
): Promise<void> {
  await fs.mkdir(path.dirname(archivePath), { recursive: true });

  const zipFile = new ZipFile();

  for (const [relativePath, content] of Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    zipFile.addBuffer(Buffer.from(content, "utf8"), relativePath);
  }

  zipFile.end();

  await pipeline(zipFile.outputStream, createWriteStream(archivePath));
}

export async function createTarGzArchive(
  archivePath: string,
  files: Record<string, string>,
): Promise<void> {
  const stagingDirectory = await fs.mkdtemp(path.join(path.dirname(archivePath), "archive-stage-"));

  try {
    for (const [relativePath, content] of Object.entries(files).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const targetPath = path.join(stagingDirectory, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf8");
    }

    await tar.c(
      {
        cwd: stagingDirectory,
        file: archivePath,
        gzip: true,
        portable: true,
      },
      Object.keys(files).sort((left, right) => left.localeCompare(right)),
    );
  } finally {
    await fs.rm(stagingDirectory, { force: true, recursive: true });
  }
}
