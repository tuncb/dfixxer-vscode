import * as assert from "node:assert/strict";
import { DocumentRunGuard } from "../../documentRunGuard";

describe("DocumentRunGuard", () => {
  it("prevents re-entrant runs for the same document", async () => {
    const guard = new DocumentRunGuard();

    let releaseFirstRun: (() => void) | undefined;

    const firstRun = guard.run("file:///sample.pas", async () => {
      await new Promise<void>((resolve) => {
        releaseFirstRun = resolve;
      });
      return "first";
    });

    const secondRun = await guard.run("file:///sample.pas", () => Promise.resolve("second"));

    assert.equal(secondRun.executed, false);

    releaseFirstRun?.();

    const firstResult = await firstRun;
    assert.equal(firstResult.executed, true);
    assert.equal(firstResult.value, "first");
    assert.equal(guard.isRunning("file:///sample.pas"), false);
  });

  it("releases the lock after a failure", async () => {
    const guard = new DocumentRunGuard();

    await assert.rejects(
      guard.run("file:///sample.pas", () => Promise.reject(new Error("boom"))),
      /boom/u,
    );

    const nextRun = await guard.run("file:///sample.pas", () => Promise.resolve("ok"));
    assert.equal(nextRun.executed, true);
    assert.equal(nextRun.value, "ok");
  });
});
