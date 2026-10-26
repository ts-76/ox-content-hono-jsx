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
const example = process.env.OX_HONO_EXAMPLE ?? "basic";
await cp(join(repo, "examples", example), app, {
  recursive: true,
  filter: (p) => !p.includes("/node_modules") && !p.includes("/dist"),
});
const publicPackage = process.env.OX_HONO_PACKAGE;
let packageSource = publicPackage;
if (!packageSource) {
  const [packed] = JSON.parse(
    run(
      ["pack", "--ignore-scripts", "--json", "--pack-destination", root],
      repo,
    ),
  );
  packageSource = "file:" + join(root, packed.filename);
}
const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
manifest.dependencies["@ts-76/ox-content-hono-jsx"] = packageSource;
await writeFile(join(app, "package.json"), JSON.stringify(manifest, null, 2));
console.log("Consumer:", app);
// Runtime-only consumers must type-check without installing the Vite compiler.
const runtimeApp = join(root, "runtime");
await mkdir(runtimeApp);
await writeFile(
  join(runtimeApp, "package.json"),
  JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      "@ts-76/ox-content-hono-jsx": packageSource,
      hono: "4.13.13",
    },
  }),
);
run(
  ["install", "--ignore-scripts", "--omit=peer", "--no-audit", "--no-fund"],
  runtimeApp,
);
await writeFile(
  join(runtimeApp, "check.ts"),
  `import {createHonoServerAdapter} from '@ts-76/ox-content-hono-jsx/server';
import {initHonoIslands} from '@ts-76/ox-content-hono-jsx/client';
createHonoServerAdapter(); void initHonoIslands;`,
);
execFileSync(
  process.execPath,
  [
    join(repo, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "check.ts",
  ],
  { cwd: runtimeApp, stdio: "inherit" },
);
assert.equal(
  await readFile(
    join(runtimeApp, "node_modules/@ox-content/vite-plugin/package.json"),
    "utf8",
  ).catch(() => null),
  null,
);
const runtimeAudit = JSON.parse(
  run(["audit", "--omit=dev", "--json"], runtimeApp),
);
assert.equal(runtimeAudit.metadata.vulnerabilities.total, 0);
console.log("Runtime-only types and dependency audit passed");

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
if (example === "basic") {
  await writeFile(
    join(app, "src/existing.ts"),
    "globalThis.existingApplicationEntry = true;",
  );
  const configFile = join(app, "vite.config.ts");
  const source = await readFile(configFile, "utf8");
  await writeFile(
    configFile,
    source.replace(
      "defineConfig({",
      'defineConfig({build:{rollupOptions:{input:{"ox-content-hono":"src/existing.ts"}}},',
    ),
  );
}
run(["run", "build"]); // A cold ordinary build, before any dev server or compilation.
if (example === "basic") {
  const manifest = JSON.parse(
    await readFile(join(app, "dist/.vite/manifest.json"), "utf8"),
  );
  assert.ok(
    manifest["src/existing.ts"],
    "Preserve even a colliding existing entry name",
  );
}
if (example === "basic") {
  await writeFile(
    join(app, "src/Standalone.tsx"),
    `import {Hono} from 'hono';
import Page from '../content/index.mdx';
import Footer from '../snippets/footer.md';
const app = new Hono();
app.get('/', c => c.html(<main><Page/><Footer/></main>));
export default app;`,
  );
  await writeFile(
    join(app, "standalone.config.ts"),
    `import {defineConfig} from 'vite';
import {oxContentHono} from '@ts-76/ox-content-hono-jsx/vite';
export default defineConfig({plugins: [oxContentHono({routes:false, frontmatter: ({title}) => ({title})})], build:{ssr:'src/Standalone.tsx',outDir:'server'}});`,
  );
  run(["exec", "--", "vite", "build", "--config", "standalone.config.ts"]);
  const bundleSource = await readFile(
    join(app, "server/Standalone.js"),
    "utf8",
  );
  assert.doesNotMatch(
    bundleSource,
    /@ox-content\/vite-plugin|@ox-content\/napi|node:module/,
  );
  const rendered = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const {default: app}=await import('./server/Standalone.js');console.log(await (await app.request('/')).text());`,
    ],
    { cwd: app, encoding: "utf8" },
  );
  assert.match(rendered, /Count: 2/);
  assert.match(rendered, /Shared frontmatter/);
  assert.match(rendered, /Imported Markdown/);
  console.log("Independent Hono SSR build passed");
}
const evidence = {
  root,
  packed: !publicPackage,
  publicPackage: publicPackage ?? null,
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
    console.log("Checking", mode, origin);
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
  console.log("Client lifecycle passed");
  for (const mode of ["dev", "preview"])
    await withServer(mode, async (origin) => {
      const errors = [];
      const page = await browser.newPage();
      page.on("pageerror", (e) => {
        errors.push(e.message);
        console.error("Browser:", e.message);
      });
      const html = await (await fetch(origin)).text();
      assert.match(html, /Count: 2/);
      assert.match(html, /data-title="true">Shared frontmatter<\/p>/);
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
      if (example === "basic")
        assert.equal(
          await staticPage
            .locator("[data-imported]")
            .evaluate((el) => getComputedStyle(el).borderTopWidth),
          "5px",
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
      if (example === "basic") {
        assert.match(
          await page.locator("[data-imported]").textContent(),
          /Imported Markdown/,
        );
        assert.deepEqual(
          JSON.parse(await page.locator("[data-yaml]").textContent()),
          { tags: ["one", "two"], nested: { value: "three" } },
        );
        await page
          .locator('[data-ox-island="Badge"][data-ox-hydrated="true"]')
          .waitFor();
        await page.locator("[data-badge]").click();
        await until(
          async () =>
            (await page.locator("[data-badge]").textContent()) ===
            "Imported MDX: 1",
          "imported named MDX component state",
        );
      }
      if (mode === "dev") {
        if (example === "basic") {
          const footer = join(app, "snippets/footer.md");
          const footerSource = await readFile(footer, "utf8");
          await writeFile(
            footer,
            footerSource.replace(
              "Imported Markdown",
              "Updated imported Markdown",
            ),
          );
          await until(
            async () =>
              /Updated imported Markdown/.test(
                await page.locator("[data-imported]").textContent(),
              ),
            "imported Markdown HMR",
          );
          await writeFile(footer, footerSource);
        }
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
      if (mode === "preview" && example === "custom-host")
        assert.doesNotMatch(plain, /<script\b/);
      await page.close();
      const plainPage = await browser.newPage();
      plainPage.on("pageerror", (e) => errors.push(e.message));
      await plainPage.goto(origin + "/plain/");
      assert.match(
        await plainPage.locator("main h1").textContent(),
        /Plain Markdown/,
      );
      if (example === "basic") {
        await plainPage
          .locator('[data-ox-island="Badge"][data-ox-hydrated="true"]')
          .waitFor();
        await plainPage.locator("[data-badge]").click();
        await until(
          async () =>
            /Imported MDX: 1/.test(
              await plainPage.locator("[data-badge]").textContent(),
            ),
          "layout island on plain page",
        );
      }
      await plainPage.close();
      assert.deepEqual(errors, []);
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
                ...(example === "basic" ? ["imported Markdown"] : []),
                "frontmatter",
                "CSS",
                "component",
                "route add",
                "route remove",
              ],
            }
          : { plainPageZeroScripts: example === "custom-host" }),
      });
    });
  if (example === "basic") {
    await writeFile(sourcePath, original);
    await writeFile(counterPath, counterSource);
    await writeFile(cssPath, cssSource);
    const configFile = join(app, "vite.config.ts");
    const configured = await readFile(configFile, "utf8");
    await writeFile(
      configFile,
      configured.replace(/layout: ["']\.\/src\/Layout\.tsx["'],?/, ""),
    );
    run(["run", "build"]);
    await withServer("preview", async (origin) => {
      const plain = await (await fetch(origin + "/plain/")).text();
      assert.doesNotMatch(plain, /<script\b/);
      const page = await browser.newPage();
      await page.goto(origin);
      await page.waitForFunction(() => window.mounts === 1);
      await page.locator("[data-counter]").click();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-counter]").textContent === "Count: 3",
      );
      await page.close();
    });
    evidence.defaultLayout = {
      build: true,
      preview: true,
      clientState: true,
      plainPageZeroScripts: true,
    };
  }
} finally {
  await browser.close();
  await writeFile(sourcePath, original);
  await writeFile(counterPath, counterSource);
  await writeFile(cssPath, cssSource);
}
await mkdir(join(repo, "artifacts"), { recursive: true });
await writeFile(
  join(repo, `artifacts/consumer-${example}.json`),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
