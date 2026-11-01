import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const registry = "https://registry.npmjs.org/";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
import { publisherInventory } from "./publisher-inventory.mjs";
import { verifyPublisherBundles } from "./publisher-bundles.mjs";
import { pathToFileURL } from "node:url";

export const policyPath = fileURLToPath(new URL("./publisher-policy.json", import.meta.url));
export const inventoryPath = fileURLToPath(new URL("./publisher-js-inventory.json", import.meta.url));
export const loadPublisherPolicy = () => JSON.parse(readFileSync(policyPath, "utf8"));
export const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sort(value[key])]),
    );
  return value;
}

export async function requestBytes(url, options = {}, limit = 4 * 1024 * 1024) {
  assert.equal(new URL(url).protocol, "https:", "Publisher network requires HTTPS");
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(30000) });
  assert.ok(response.ok, "Publisher preflight/service failed");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) {
      await response.body.cancel().catch(() => {});
      throw new Error("Publisher response exceeds limit");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export const requestJson = async (url, options) => JSON.parse((await requestBytes(url, options)).toString("utf8"));

export function checkPublisherFinding(policy, pkg, advisory) {
  const accepted = policy.acceptedFindings.find(
    (item) => item.name === pkg.name && item.version === pkg.version && item.id === advisory.id,
  );
  assert.ok(accepted, `Unreviewed publisher advisory: ${pkg.name}@${pkg.version} ${advisory.id}`);
  assert.equal(advisory.modified, accepted.modified, "Publisher advisory changed; reassess");
  assert.equal(sha256(canonical(advisory)), accepted.advisorySha256, "Publisher advisory content changed; reassess");
  assert.ok(accepted.reason);
  return { name: pkg.name, version: pkg.version, id: advisory.id, reason: accepted.reason };
}

export async function auditPublisher({ policy = loadPublisherPolicy(), request = requestJson } = {}) {
  assert.equal(policy.schema, 3);
  assert.equal(policy.manager, "npm");
  const inventoryBytes = readFileSync(inventoryPath);
  assert.equal(sha256(inventoryBytes), policy.inventorySha256, "Publisher inventory changed");
  const inventory = JSON.parse(inventoryBytes);
  const queries = inventory.map((pkg) => ({ package: { name: pkg.name, ecosystem: "npm" }, version: pkg.version }));
  const batch = await request("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries }),
  });
  assert.equal(batch.results?.length, inventory.length, "Incomplete publisher audit");
  const findings = [];
  for (const [index, result] of batch.results.entries()) {
    assert.ok(!result.next_page_token, "Publisher audit pagination requires review");
    for (const item of result.vulns || []) {
      assert.match(item.id, /^(?:CVE-\d{4}-\d+|GHSA-[a-z0-9-]+)$/);
      const advisory = await request(`https://api.osv.dev/v1/vulns/${item.id}`);
      assert.equal(advisory.id, item.id);
      findings.push(checkPublisherFinding(policy, inventory[index], advisory));
    }
  }
  const keys = (list) => list.map((item) => `${item.name}@${item.version}:${item.id}`).sort();
  assert.deepEqual(keys(findings), keys(policy.acceptedFindings), "Publisher findings changed; reassess");
  return {
    manager: policy.manager,
    version: policy.version,
    node: policy.node,
    target: policy.target,
    sourceCommit: policy.sourceCommit,
    policySha256: sha256(readFileSync(policyPath)),
    inventorySha256: policy.inventorySha256,
    auditedPackages: inventory.length,
    findings,
    status: "accepted only within reviewed stage scope",
  };
}

export function publisherSnapshot(root) {
  const table = [];
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        assert.ok(entry.isFile(), "Publisher contains non-regular file");
        const name = path.relative(root, file).replaceAll("\\", "/");
        const bytes = readFileSync(file);
        table.push({ path: name, sha256: sha256(bytes) });
        if (/\.(?:mjs|cjs|js|js\.map)$/.test(name) || name.endsWith("package.json"))
          files.set(name, bytes.toString("utf8"));
      }
    }
  };
  visit(root);
  table.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, filesSha256: sha256(JSON.stringify(table, null, 2) + "\n"), inventory: publisherInventory(files) };
}

export function verifyPublisher(cli, policy = loadPublisherPolicy(), { local = false } = {}) {
  if (local) assert.notEqual(process.env.GITHUB_ACTIONS, "true");
  else {
    assert.equal(process.platform, "linux");
    assert.equal(process.arch, "x64");
  }
  assert.equal(process.version, `v${policy.node}`);
  assert.ok(lstatSync(cli).isFile() && !lstatSync(cli).isSymbolicLink());
  assert.equal(sha256(readFileSync(cli)), policy.distribution.entrySha256, "Publisher CLI changed");
  const root = path.resolve(path.dirname(cli), "..");
  const { files, filesSha256, inventory } = publisherSnapshot(root);
  assert.equal(filesSha256, policy.filesSha256, "Publisher files changed");
  assert.deepEqual(
    inventory,
    JSON.parse(readFileSync(inventoryPath)),
    "Publisher inventory differs from distributed files",
  );
  verifyPublisherBundles(files, inventory);
  assert.equal(JSON.parse(files.get("package.json")).version, policy.version);
}

export function measurePublisherCoverage(cli, directory) {
  const root = path.resolve(path.dirname(cli), "..");
  const entries = readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => JSON.parse(readFileSync(path.join(directory, file), "utf8")).result);
  for (const file of ["bin/npm-cli.js", "lib/commands/publish.js"]) {
    const entry = entries.find((item) => item.url === pathToFileURL(path.join(root, file)).href);
    assert.ok(
      entry?.functions.some((fn) => fn.ranges[0].count > 0),
      `Missing publisher execution coverage: ${file}`,
    );
  }
  return { stageCommandExecuted: true, method: "V8 coverage of verified npm runtime" };
}

export async function exchangeOidc(env, request = requestJson) {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.ok(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN && env.ACTIONS_ID_TOKEN_REQUEST_URL, "OIDC permissions missing");
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  assert.equal(url.protocol, "https:");
  assert.ok(url.hostname.endsWith(".actions.githubusercontent.com"), "Unexpected OIDC authority");
  url.searchParams.set("audience", "npm:registry.npmjs.org");
  const identity = await request(url.href, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  assert.ok(
    typeof identity.value === "string" && identity.value.length && !/[\r\n]/.test(identity.value),
    "OIDC identity token missing",
  );
  const exchanged = await request(
    `${registry}-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(env.PUBLISH_PACKAGE_NAME)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${identity.value}`, "Content-Type": "application/json" },
    },
  );
  assert.ok(
    typeof exchanged.token === "string" && /^[A-Za-z0-9._~-]+$/.test(exchanged.token),
    "OIDC registry token missing",
  );
  return exchanged.token;
}

export function publisherEnvironment(env, root) {
  const keep = [
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "GITHUB_ACTIONS",
    "GITHUB_SERVER_URL",
    "GITHUB_REPOSITORY",
    "GITHUB_REF",
    "GITHUB_SHA",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_EVENT_NAME",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_REPOSITORY_OWNER_ID",
    "RUNNER_ENVIRONMENT",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  ];
  return {
    ...Object.fromEntries(keep.filter((key) => env[key] !== undefined).map((key) => [key, env[key]])),
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_DATA_HOME: path.join(root, "data"),
    NPM_CONFIG_GLOBALCONFIG: path.join(root, "global.npmrc"),
    NPM_CONFIG_CACHE: path.join(root, "cache"),
    NODE_DISABLE_COMPILE_CACHE: "1",
  };
}
