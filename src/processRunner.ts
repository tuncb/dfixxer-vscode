import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProcessResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface ProcessRunnerOptions {
  cwd?: string;
}

export type ProcessRunner = (
  executablePath: string,
  args: readonly string[],
  options?: ProcessRunnerOptions,
) => Promise<ProcessResult>;

export const execFileProcessRunner: ProcessRunner = async (
  executablePath,
  args,
  options,
) => {
  try {
    const result = await execFileAsync(executablePath, [...args], {
      cwd: options?.cwd,
      windowsHide: true,
    });

    return {
      exitCode: 0,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } catch (error: unknown) {
    const processError = error as NodeJS.ErrnoException & {
      code?: number | string;
      stderr?: string | Buffer;
      stdout?: string | Buffer;
    };

    return {
      exitCode:
        typeof processError.code === "number" ? processError.code : 1,
      stderr: bufferToString(processError.stderr),
      stdout: bufferToString(processError.stdout),
    };
  }
};

function bufferToString(value: Buffer | string | undefined): string {
  if (!value) {
    return "";
  }

  return typeof value === "string" ? value : value.toString("utf8");
}
