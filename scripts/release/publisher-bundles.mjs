import assert from "node:assert/strict";

// Some upstream packages distribute bundled JS as their default entrypoint.
// Their source maps identify the embedded sources, which must match the exact
// packages represented in the audited inventory. Archive/file hashes remain
// the authority for the distributed executable bytes.
export function verifyPublisherBundles(files, inventory) {
  const names = new Set(inventory.map(({ name }) => name));
  let embedded = 0;
  for (const [file, text] of files) {
    if (!file.endsWith(".js.map")) continue;
    const map = JSON.parse(text);
    if (!Array.isArray(map.sources) || !map.sources.some((source) => source.includes("node_modules/"))) continue;
    assert.equal(map.sources.length, map.sourcesContent?.length, `Missing source content: ${file}`);
    for (const [index, source] of map.sources.entries()) {
      if (!source.includes("node_modules/")) continue;
      const match = source.match(/^\.\.\/\.\.\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/);
      assert.ok(match, `Unknown bundled source path: ${source}`);
      const [, name] = match;
      assert.ok(names.has(name), `Bundled package is not audited: ${name}`);
      const content = map.sourcesContent[index];
      assert.ok(typeof content === "string" && content.length, `Missing bundled source: ${source}`);
      const prefix = `node_modules/${name}/`;
      const found = [...files].some(([candidate, candidateText]) => {
        if (!candidate.startsWith(prefix) || !candidate.endsWith(".js.map")) return false;
        return JSON.parse(candidateText).sourcesContent?.includes(content);
      });
      assert.ok(found, `Bundled source differs from audited package: ${source}`);
      embedded++;
    }
  }
  assert.ok(embedded, "Expected bundled publisher sources were not inspected");
  return embedded;
}
