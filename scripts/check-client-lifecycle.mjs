import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";

export async function checkClientLifecycle({ app, browser }) {
  const built = await build({
    stdin: {
      resolveDir: app,
      contents: `
import {jsx,useEffect} from 'hono/jsx';
import {useFrontmatter} from '@ts-76/ox-content-hono-jsx';
import {createHonoHydrate,initHonoIslands} from '@ts-76/ox-content-hono-jsx/client';
window.mounted=[];window.unmounted=[];window.errors=[];window.rendered=[];
function Counter({id}){window.rendered.push(id);const {title}=useFrontmatter();useEffect(()=>{window.mounted.push(id);return()=>window.unmounted.push(id)},[]);return jsx('button',{'data-test':id},title);}
function island(id,load='eager',media){const el=document.createElement('div');el.dataset.oxIsland='Counter';el.dataset.oxModule='/Counter.js';el.dataset.oxProps=JSON.stringify({props:{id},expressions:{},spreads:[]});const marker=document.createElement('script');marker.type='application/json';marker.dataset.oxHonoContext='';marker.textContent=JSON.stringify({frontmatter:{title:id},load,media});el.innerHTML='<span data-ssr>Server content</span>';el.append(marker);document.body.append(el);return el;}
window.runBasic=async()=>{const el=island('A');const hydrate=createHonoHydrate({modules:{'/Counter.js':()=>({default:Counter})}});const dispose=hydrate(el,{id:'A'});await dispose;window.dispose=dispose;};
window.runEarly=async()=>{const el=island('early');const hydrate=createHonoHydrate({modules:{'/Counter.js':()=>({default:Counter})}});const dispose=hydrate(el,{id:'early'});for(let i=0;i<30&&!window.rendered.includes('early');i++)await Promise.resolve();if(!window.rendered.includes('early'))throw Error('Early island was not rendered');dispose();await dispose;return el.childNodes.length===0;};
window.runCancel=async()=>{const el=island('cancel');const before=el.innerHTML;let resolve;const pending=new Promise(r=>resolve=r);const hydrate=createHonoHydrate({modules:{'/Counter.js':()=>pending}});const dispose=hydrate(el,{id:'cancel'});dispose();resolve({default:Counter});await dispose;return el.innerHTML===before;};
window.runFailure=async()=>{const el=island('missing');const before=el.innerHTML;const hydrate=createHonoHydrate({modules:{},onError:e=>window.errors.push(e.code)});const dispose=hydrate(el,{});try{await dispose;}catch{}return el.innerHTML===before;};
window.runStrategies=()=>{document.body.replaceChildren();window.mounted=[];window.unmounted=[];window.idle=[];window.requestIdleCallback=cb=>{window.idle.push(cb);return window.idle.length};window.cancelIdleCallback=()=>{};const eager=island('eager');const idle=island('idle','idle');const visible=island('visible','visible');visible.style.marginTop='4000px';const media=island('media','media','(max-width: 500px)');window.controller=initHonoIslands({modules:{'/Counter.js':()=>({default:Counter})}});return true;};
window.ready=true;
`,
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      '<!doctype html><html><body><script type="module">' +
        built.outputFiles[0].text +
        "</script></body></html>",
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const page = await browser.newPage({
    viewport: { width: 1000, height: 600 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => window.runBasic());
    await page.waitForFunction(() => window.mounted.includes("A"));
    assert.equal(await page.locator('[data-test="A"]').textContent(), "A");
    await page.evaluate(() => {
      window.dispose();
      window.dispose();
    });
    await page.waitForFunction(() => window.unmounted.length === 1);
    assert.equal(await page.locator('[data-test="A"]').count(), 0);
    assert.equal(await page.evaluate(() => window.runEarly()), true);
    await page.waitForFunction(() => window.unmounted.includes("early"));
    assert.equal(await page.evaluate(() => window.runCancel()), true);
    assert.equal(
      await page.evaluate(() => window.mounted.includes("cancel")),
      false,
    );
    assert.equal(await page.evaluate(() => window.runFailure()), true);
    assert.deepEqual(await page.evaluate(() => window.errors), [
      "unknown-module",
    ]);
    await page.evaluate(() => window.runStrategies());
    await page.waitForFunction(() => window.mounted.includes("eager"));
    assert.deepEqual(await page.evaluate(() => window.mounted), ["eager"]);
    await page.evaluate(() =>
      window.idle.forEach((cb) =>
        cb({ didTimeout: false, timeRemaining: () => 100 }),
      ),
    );
    await page.waitForFunction(() => window.mounted.includes("idle"));
    await page.locator("[data-ox-island]").nth(2).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.mounted.includes("visible"));
    await page.setViewportSize({ width: 390, height: 600 });
    await page.waitForFunction(() => window.mounted.includes("media"));
    await page.evaluate(() => window.controller.destroy());
    await page.waitForFunction(() => window.unmounted.length === 4);
    assert.equal(await page.locator("[data-test]").count(), 0);
    assert.deepEqual(errors, []);
    return {
      strategies: ["eager", "idle", "visible", "media"],
      disposeExactlyOnce: true,
      disposeBeforeFirstEffect: true,
      cancelBeforeLoad: true,
      missingModulePreservesSSR: true,
    };
  } finally {
    await page.close();
    await new Promise((r) => server.close(r));
  }
}
