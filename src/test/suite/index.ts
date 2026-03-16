import * as path from "node:path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
  const mocha = new Mocha({
    color: true,
    timeout: 10000,
    ui: "tdd",
  });

  const files = await glob("**/*.test.js", {
    cwd: __dirname,
    absolute: true,
  });

  for (const file of files) {
    mocha.addFile(path.resolve(file));
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension test(s) failed.`));
        return;
      }

      resolve();
    });
  });
}
