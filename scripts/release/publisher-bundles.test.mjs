import test from "node:test";
import assert from "node:assert/strict";
import { verifyPublisherBundles } from "./publisher-bundles.mjs";

await test("bundled sources must match the audited installed packages", () => {
  const files = new Map([
    [
      "node_modules/glob/dist/commonjs/index.min.js.map",
      JSON.stringify({ sources: ["../../node_modules/minimatch/src/index.ts"], sourcesContent: ["fixed source"] }),
    ],
    [
      "node_modules/minimatch/dist/commonjs/index.js.map",
      JSON.stringify({ sources: ["../../src/index.ts"], sourcesContent: ["fixed source"] }),
    ],
  ]);
  const inventory = [{ name: "minimatch", version: "11.0.2" }];
  assert.equal(verifyPublisherBundles(files, inventory), 1);
  assert.throws(() => verifyPublisherBundles(files, []), /not audited/);
  files.set(
    "node_modules/minimatch/dist/commonjs/index.js.map",
    JSON.stringify({ sources: ["../../src/index.ts"], sourcesContent: ["different source"] }),
  );
  assert.throws(() => verifyPublisherBundles(files, inventory), /differs/);
  assert.throws(() => verifyPublisherBundles(new Map(), inventory), /not inspected/);
});
