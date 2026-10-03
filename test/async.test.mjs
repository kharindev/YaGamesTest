import test from "node:test";
import assert from "node:assert/strict";
import { withDeadline, boundedMethods } from "../checks/async.mjs";
import { readFileSync } from "node:fs";

test("release documentation matches the manifest version", () => {
  const { version } = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes(`## Версия ${version}`));
  assert.ok(readme.includes(`YaGamesTest-${version}.zip`));
  assert.ok(readFileSync(new URL(`../releases/v${version}.md`, import.meta.url), "utf8").includes(version));
});

test("deadline releases a permanently pending external operation", async () => {
  await assert.rejects(withDeadline(() => new Promise(() => {}), "capture", 10), /capture.*превышено ожидание/);
  assert.equal(await withDeadline(() => 42, "next", 10), 42);
});

test("deadline handles sync exceptions and preserves API receiver", async () => {
  await assert.rejects(withDeadline(() => { throw Error("sync failure"); }, "api", 10), /sync failure/);
  const api = boundedMethods({ value: 7, get() { return this.value; } }, ["get"], "api", 10);
  assert.equal(await api.get(), 7);
});
