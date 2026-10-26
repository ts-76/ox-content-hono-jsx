import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.GITHUB_EVENT_NAME, "push");
assert.equal(process.env.GITHUB_REPOSITORY, "ts-76/ox-content-hono-jsx");
assert.ok(
  process.env.GITHUB_REF === "refs/heads/main" ||
    /^refs\/tags\/v\d+\.\d+\.\d+$/.test(process.env.GITHUB_REF),
);
assert.ok(process.env.RELEASE_CLI);
const pkg = JSON.parse(readFileSync("package.json"));
assert.equal(pkg.name, "@ts-76/ox-content-hono-jsx");
const archive = `artifacts/ts-76-ox-content-hono-jsx-${pkg.version}.tgz`;
const bytes = readFileSync(archive);
const require = createRequire(
  path.join(path.dirname(process.env.RELEASE_CLI), "../package.json"),
);
const npa = require("npm-package-arg");
const { generateProvenance, verifyProvenance } = require(
  path.join(path.dirname(require.resolve("libnpmpublish")), "provenance.js"),
);
const subject = {
  name: npa.toPurl(npa.resolve(pkg.name, pkg.version)),
  digest: { sha512: createHash("sha512").update(bytes).digest("hex") },
};
const bundle = await generateProvenance([subject], {});
const file = archive + ".sigstore";
writeFileSync(file, JSON.stringify(bundle));
await verifyProvenance(subject, file);
const statement = JSON.parse(
  Buffer.from(bundle.dsseEnvelope.payload, "base64"),
);
assert.ok(
  statement.predicate.buildDefinition.resolvedDependencies.some(
    (entry) => entry.digest.gitCommit === process.env.GITHUB_SHA,
  ),
);
assert.equal(
  statement.predicate.buildDefinition.externalParameters.workflow.ref,
  process.env.GITHUB_REF,
);
console.log(
  `Verified provenance for ${pkg.name}@${pkg.version} at ${process.env.GITHUB_SHA}. No npm upload performed.`,
);
