import { readFileSync } from "node:fs";
import { verifyDependencyRisk } from "./dependency-risk.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const result = spawnSync("npm", ["audit", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});
assert.ok(result.status === 0 || result.status === 1, result.stderr);
const audit = JSON.parse(result.stdout);
console.log(JSON.stringify(await verifyDependencyRisk({
  pkg: JSON.parse(readFileSync("package.json")),
  lockBytes: readFileSync("package-lock.json"),
  audit,
  policy: JSON.parse(readFileSync(new URL("./dependency-risk.json", import.meta.url))),
})));
