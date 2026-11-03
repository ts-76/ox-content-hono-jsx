import test from "node:test";
import assert from "node:assert/strict";
import { verifyDependencyRisk, canonical, digest } from "../scripts/dependency-risk.mjs";

function fixture() {
  const record = { id: "GHSA-3g3m-2fjr-6pw4", modified: "reviewed", summary: "Reviewed record" };
  const lockBytes = Buffer.from(JSON.stringify({ packages: { "node_modules/@ox-content/vite-plugin": { version: "3.8.2" } } }));
  return {
    pkg: { version: "0.1.1", devDependencies: { "@ox-content/vite-plugin": "3.8.2" } },
    lockBytes,
    audit: { metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 1 } }, vulnerabilities: { glob: { name: "glob", via: [{ url: `https://github.com/advisories/${record.id}` }] } } },
    policy: { schema: 1, approvedBy: "ts-76", packageVersion: "0.1.1", lockSha256: digest(lockBytes), oxVersion: "3.8.2", scope: "Trusted build only", affectedPackages: ["glob"], advisories: [{ id: record.id, modified: record.modified, sha256: digest(canonical(record)) }] },
    fetchImpl: async () => ({ status: 200, json: async () => record }),
  };
}

test("build risk acceptance remains nonzero and expires when version, lock, finding or severity changes", async () => {
  const f = fixture();
  assert.equal((await verifyDependencyRisk(f)).counts.moderate, 1);
  for (const change of [
    { pkg: { ...f.pkg, version: "0.1.2" } },
    { lockBytes: Buffer.from("changed") },
    { audit: { ...f.audit, vulnerabilities: { other: { name: "other", via: [] } } } },
    { audit: { ...f.audit, vulnerabilities: { glob: { name: "glob", via: [{ url: "new" }] } } } },
    { audit: { ...f.audit, metadata: { vulnerabilities: { high: 1, critical: 0 } } } },
  ]) await assert.rejects(verifyDependencyRisk({ ...f, ...change }));
});

test("changed, withdrawn or unavailable advisory contents cannot reuse owner acceptance", async () => {
  const f = fixture();
  for (const change of [{ summary: "Changed content" }, { modified: "later" }, { withdrawn: "today" }])
    await assert.rejects(verifyDependencyRisk({ ...f, fetchImpl: async () => ({ status: 200, json: async () => ({ id: f.policy.advisories[0].id, modified: "reviewed", summary: "Reviewed record", ...change }) }) }));
  await assert.rejects(verifyDependencyRisk({ ...f, fetchImpl: async () => ({ status: 503 }) }));
});
