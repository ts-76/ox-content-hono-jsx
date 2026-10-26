import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { build as bundle } from "esbuild";
import { checkClientLifecycle } from "./check-client-lifecycle.mjs";

const repo = resolve(import.meta.dirname, "..");
const root = await mkdtemp(join(tmpdir(), "ox-content-hono-consumer-"));
const app = join(root, "app");
const run = (args, cwd = app) => {
  try {
    return execFileSync("npm", args, {
      cwd,
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    console.error(e.stdout, e.stderr);
    throw e;
  }
};
await cp(join(repo, "examples/basic"), app, {
  recursive: true,
  filter: (p) => !p.includes("/node_modules") && !p.includes("/dist"),
});
const [packed] = JSON.parse(
  run(["pack", "--ignore-scripts", "--json", "--pack-destination", root], repo),
);
const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
manifest.dependencies["@ts-76/ox-content-hono-jsx"] =
  "file:" + join(root, packed.filename);
await writeFile(join(app, "package.json"), JSON.stringify(manifest, null, 2));
console.log("Consumer:", app);
run(["install", "--ignore-scripts", "--omit=peer", "--no-audit", "--no-fund"]);
const installed = JSON.parse(
  await readFile(
    join(app, "node_modules/@ts-76/ox-content-hono-jsx/package.json"),
    "utf8",
  ),
);
assert.deepEqual(Object.keys(installed.dependencies), ["@ox-content/islands"]);
for (const dependency of [
  "react",
  "react-dom",
  "@ts-76/hono-markdown",
  "void-plugin-hono-jsx",
  "hono-decks",
  "honoxpress",
]) {
  assert.equal(
    await readFile(
      join(app, "node_modules", dependency, "package.json"),
      "utf8",
    ).catch(() => null),
    null,
    dependency,
  );
}
// Verify browser/runtime boundaries from the actual packed package.
const graph = await bundle({
  stdin: {
    contents:
      "import {initHonoIslands} from '@ts-76/ox-content-hono-jsx/client'; globalThis.init=initHonoIslands;",
    resolveDir: app,
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
  metafile: true,
});
assert.doesNotMatch(
  Object.keys(graph.metafile.inputs).join("\n"),
  /@ox-content\/(?:napi|vite-plugin)|node:|markdown-exit|shiki/,
);
execFileSync(
  process.execPath,
  [
    join(repo, "node_modules/typescript/bin/tsc"),
    "-p",
    join(app, "tsconfig.json"),
  ],
  { cwd: app, stdio: "inherit" },
);
run(["run", "build"]); // A cold ordinary build, before any dev server or compilation.
const evidence = {
  root,
  packed: true,
  sourceLinks: false,
  initialBuild: true,
  browserInputs: Object.keys(graph.metafile.inputs).length,
  modes: [],
};
async function port() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const p = server.address().port;
  await new Promise((r) => server.close(r));
  return p;
}
async function until(fn, detail) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("Timed out: " + detail);
}
async function withServer(mode, check) {
  const p = await port();
  const child = spawn(
    "npm",
    ["run", mode, "--", "--port", String(p), "--strictPort"],
    {
      cwd: app,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (b) => (logs = (logs + b).slice(-18000)));
  const origin = "http://127.0.0.1:" + p;
  try {
    await until(async () => {
      if (child.exitCode !== null) throw Error(logs);
      return (await fetch(origin)).status === 200;
    }, "server " + mode);
    await check(origin);
  } catch (e) {
    console.error(logs);
    throw e;
  } finally {
    if (child.exitCode === null) {
      const stop = (signal) => {
        try {
          process.kill(-child.pid, signal);
        } catch (e) {
          if (e.code !== "ESRCH") throw e;
        }
      };
      stop("SIGTERM");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (child.exitCode === null) stop("SIGKILL");
    }
  }
}
const browser = await chromium.launch();
const sourcePath = join(app, "content/index.mdx");
const original = await readFile(sourcePath, "utf8");
const counterPath = join(app, "content/Counter.tsx");
const counterSource = await readFile(counterPath, "utf8");
const cssPath = join(app, "content/counter.css");
const cssSource = await readFile(cssPath, "utf8");
try {
  evidence.lifecycle = await checkClientLifecycle({ app, browser });
  for (const mode of ["dev", "preview"])
    await withServer(mode, async (origin) => {
      const errors = [];
      const page = await browser.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      const html = await (await fetch(origin)).text();
      assert.match(html, /Count: 2/);
      assert.match(html, /Shared frontmatter/);
      assert.doesNotMatch(html, /never sent to client/);
      const nojs = await browser.newContext({ javaScriptEnabled: false });
      const staticPage = await nojs.newPage();
      await staticPage.goto(origin);
      assert.equal(
        await staticPage.locator("[data-counter]").textContent(),
        "Count: 2",
      );
      assert.equal(
        await staticPage
          .locator(".counter")
          .evaluate((el) => getComputedStyle(el).borderTopWidth),
        "3px",
      );
      await nojs.close();
      await page.goto(origin);
      await page.waitForFunction(() => window.mounts === 1);
      await page.locator("[data-counter]").click();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-counter]").textContent === "Count: 3",
      );
      assert.equal(
        await page.locator("[data-title]").textContent(),
        "Shared frontmatter",
      );
      assert.equal(
        await page.locator("[data-slot] strong").textContent(),
        "bold",
      );
      if (mode === "dev") {
        await writeFile(
          sourcePath,
          original.replace("Shared frontmatter", "Changed frontmatter"),
        );
        await until(
          async () =>
            (await page.locator("[data-title]").textContent()) ===
            "Changed frontmatter",
          "frontmatter HMR",
        );
        await writeFile(cssPath, cssSource.replace("3px", "7px"));
        await until(
          async () =>
            (await page
              .locator(".counter")
              .evaluate((el) => getComputedStyle(el).borderTopWidth)) === "7px",
          "CSS HMR",
        );
        await writeFile(
          counterPath,
          counterSource.replace("Count:", "Updated:"),
        );
        await until(
          async () =>
            /Updated:/.test(await page.locator("[data-counter]").textContent()),
          "component HMR",
        );
        await writeFile(join(app, "content/added.mdx"), "# Added page\n");
        await until(
          async () => (await fetch(origin + "/added/")).status === 200,
          "route add",
        );
        await rm(join(app, "content/added.mdx"));
        await until(
          async () => (await fetch(origin + "/added/")).status === 404,
          "route remove",
        );
      }
      const plainResponse = await fetch(origin + "/plain/");
      assert.equal(plainResponse.status, 200);
      const plain = await plainResponse.text();
      if (mode === "preview") assert.doesNotMatch(plain, /<script\b/);
      await page.goto(origin + "/plain/");
      assert.match(await page.locator("h1").textContent(), /Plain Markdown/);
      assert.deepEqual(errors, []);
      await page.close();
      evidence.modes.push({
        mode,
        ssr: true,
        withoutJavaScript: true,
        clientState: true,
        slot: true,
        frontmatter: true,
        css: true,
        noBrowserErrors: true,
        ...(mode === "dev"
          ? {
              hmr: [
                "frontmatter",
                "CSS",
                "component",
                "route add",
                "route remove",
              ],
            }
          : { plainPageZeroScripts: true }),
      });
    });
} finally {
  await browser.close();
  await writeFile(sourcePath, original);
  await writeFile(counterPath, counterSource);
  await writeFile(cssPath, cssSource);
}
await mkdir(join(repo, "artifacts"), { recursive: true });
await writeFile(
  join(repo, "artifacts/consumer.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
