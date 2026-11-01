import assert from "node:assert/strict";

/** Inventory the exact distributed bundle, not pnpm's install-time manifest. */
export function publisherInventory(files) {
  const packages = new Map();
  const add = (name, version) => {
    assert.match(version, /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
    const key = `${name}@${version}`;
    packages.set(key, { name, version });
  };
  for (const [file, text] of files) {
    if (/\.(?:mjs|cjs|js)$/.test(file)) {
      for (const match of text.matchAll(/links\/@\/((?:@[^/]+\/)?[^/]+)\/([0-9][^/]*)\/[a-f0-9]{32,}\/node_modules\//g))
        add(match[1], match[2]);
    } else if (file.endsWith("package.json")) {
      const pkg = JSON.parse(text);
      if (typeof pkg.name === "string" && typeof pkg.version === "string") add(pkg.name, pkg.version);
    }
  }
  assert.ok(packages.size, "Publisher inventory is empty");
  return [...packages.values()].sort(
    (a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"),
  );
}
