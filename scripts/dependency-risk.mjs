import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function verifyDependencyRisk({ pkg, lockBytes, audit, policy, fetchImpl = fetch }) {
  assert.equal(policy.schema, 1);
  assert.equal(policy.approvedBy, "ts-76");
  assert.equal(pkg.version, policy.packageVersion, "Risk acceptance expired: package version");
  assert.equal(digest(lockBytes), policy.lockSha256, "Risk acceptance expired: lockfile");
  assert.equal(pkg.devDependencies["@ox-content/vite-plugin"], policy.oxVersion);
  const lock = JSON.parse(lockBytes);
  assert.equal(lock.packages["node_modules/@ox-content/vite-plugin"].version, policy.oxVersion);
  assert.ok(audit.metadata && audit.vulnerabilities && !audit.error, "Incomplete dependency audit");
  assert.equal(audit.metadata.vulnerabilities.high, 0);
  assert.equal(audit.metadata.vulnerabilities.critical, 0);
  assert.ok(policy.advisories.length > 0);
  const expected = new Set(policy.advisories.map((item) => `https://github.com/advisories/${item.id}`));
  assert.equal(expected.size, policy.advisories.length, "Duplicate accepted advisory");
  for (const item of Object.values(audit.vulnerabilities)) {
    assert.ok(policy.affectedPackages.includes(item.name), `New affected dependency: ${item.name}`);
    for (const via of item.via)
      if (typeof via === "object")
        assert.ok(expected.has(via.url), `Unreviewed advisory: ${via.url}`);
  }
  for (const item of policy.advisories) {
    assert.match(item.id, /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    const response = await fetchImpl(`https://api.osv.dev/v1/vulns/${item.id}`, {
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
    assert.equal(response.status, 200, "Cannot refresh accepted advisory");
    const advisory = await response.json();
    assert.equal(advisory.id, item.id);
    assert.equal(advisory.withdrawn, undefined, "Accepted advisory withdrawn; reassess");
    assert.equal(advisory.modified, item.modified, "Accepted advisory modified; reassess");
    assert.equal(digest(canonical(advisory)), item.sha256, "Accepted advisory content changed; reassess");
  }
  return { scope: policy.scope, counts: audit.metadata.vulnerabilities, knownAdvisories: [...expected] };
}
