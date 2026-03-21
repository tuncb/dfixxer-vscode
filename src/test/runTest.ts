import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, "../../");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [path.resolve(extensionDevelopmentPath, "test-fixtures", "workspace")],
  });
}

void main().catch((error: unknown) => {
  console.error("Failed to run extension tests.", error);
  process.exitCode = 1;
});
