import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const cli = process.env.RELEASE_CLI;
assert.ok(cli, "RELEASE_CLI is required");
const root = await mkdtemp(path.join(tmpdir(), "publisher-runtime-test-"));
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.method);
  res.writeHead(req.method === "GET" ? 404 : 405, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "fixture registry" }));
});
await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
try {
  const pkg = path.join(root, "package");
  const output = path.join(root, "output");
  await mkdir(pkg);
  await mkdir(output);
  await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "publisher-fixture", version: "1.0.0" }));
  await writeFile(path.join(pkg, ".npmignore"), "*.secret\nprivate/\n");
  await writeFile(path.join(pkg, "index.js"), "export const ok = true;\n");
  await writeFile(path.join(pkg, "hidden.secret"), "must not ship\n");
  await mkdir(path.join(pkg, "private"));
  await writeFile(path.join(pkg, "private", "notes.txt"), "must not ship\n");
  const userConfig = path.join(root, "user.npmrc");
  const globalConfig = path.join(root, "global.npmrc");
  await writeFile(userConfig, "");
  await writeFile(globalConfig, "");
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    TMPDIR: root,
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: path.join(root, "cache"),
    npm_config_update_notifier: "false",
  };
  const run = (args, cwd = root) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], { cwd, env });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      const timer = setTimeout(() => child.kill("SIGTERM"), 30000);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr));
      });
    });
  const pack = JSON.parse(
    await run(["pack", pkg, "--ignore-scripts", "--workspaces=false", "--json", "--pack-destination", output]),
  );
  assert.equal(pack.length, 1);
  const archive = path.join(output, pack[0].filename);
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(names, ["package/index.js", "package/package.json"]);
  const before = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  const registry = `http://127.0.0.1:${server.address().port}/`;
  for (const args of [["stage", "publish"], ["publish"]]) {
    await run([
      ...args,
      archive,
      "--dry-run",
      "--ignore-scripts",
      "--workspaces=false",
      "--registry",
      registry,
      "--tag",
      "test",
      "--provenance=false",
      "--fetch-retries=0",
      "--fetch-timeout=5000",
    ]);
  }
  assert.ok(requests.length > 0 && requests.every((method) => method === "GET"), "Dry-run made a registry write");
  assert.equal(
    createHash("sha256")
      .update(await readFile(archive))
      .digest("hex"),
    before,
  );
  await run(["version", "1.0.1", "--no-git-tag-version", "--ignore-scripts"], pkg);
  assert.equal(JSON.parse(await readFile(path.join(pkg, "package.json"), "utf8")).version, "1.0.1");
  console.log("Publisher pack, ignore rules, version and loopback-only dry-runs passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
