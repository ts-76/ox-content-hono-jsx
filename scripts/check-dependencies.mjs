import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const result = spawnSync("npm", ["audit", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});
assert.ok(result.status === 0 || result.status === 1, result.stderr);
const audit = JSON.parse(result.stdout);
assert.ok(
  audit.metadata && audit.vulnerabilities && !audit.error,
  "Incomplete dependency audit",
);
const expected = new Set([
  "https://github.com/advisories/GHSA-px8p-9vwx-vf98",
  "https://github.com/advisories/GHSA-238p-pmpm-9mq7",
]);
for (const item of Object.values(audit.vulnerabilities)) {
  assert.ok(
    [
      "@ox-content/vite-plugin",
      "fflate",
      "katex",
      "mermaid",
      "satori",
    ].includes(item.name),
    `New affected dependency: ${item.name}`,
  );
  for (const via of item.via)
    if (typeof via === "object")
      assert.ok(expected.has(via.url), `Unreviewed advisory: ${via.url}`);
}
assert.equal(audit.metadata.vulnerabilities.high, 0);
assert.equal(audit.metadata.vulnerabilities.critical, 0);
console.log(
  JSON.stringify({
    scope: "development/build dependencies; see README",
    counts: audit.metadata.vulnerabilities,
    knownAdvisories: [...expected],
  }),
);
