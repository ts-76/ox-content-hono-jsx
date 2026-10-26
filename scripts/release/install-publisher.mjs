import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadPublisherPolicy, requestBytes, verifyPublisher } from './publisher.mjs';
import { sha256 } from './publisher.mjs';

const policy = loadPublisherPolicy();
const local = process.argv.includes('--local');
assert.equal(process.version, `v${policy.node}`);
if (local) assert.notEqual(process.env.GITHUB_ACTIONS, 'true');
else {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
}
assert.ok(process.env.RUNNER_TEMP);
const root = path.join(process.env.RUNNER_TEMP, 'publisher-cli');
mkdirSync(root, { mode: 0o700 });
const lockBytes = readFileSync(new URL('./npm-publisher-lock.json', import.meta.url));
assert.equal(sha256(lockBytes), policy.lockSha256, 'Publisher lock changed');
const lock = JSON.parse(lockBytes);
const extractor = new URL('./extract-publisher.py', import.meta.url).pathname;
let archiveSequence = 0;
async function extract(url, integrity, target, withoutBundle = false) {
  const sequence = archiveSequence++;
  assert.ok(url.startsWith('https://registry.npmjs.org/'));
  assert.match(integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  const bytes = await requestBytes(url, {}, 32 * 1024 * 1024);
  assert.equal(
    `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    integrity,
    'Publisher archive integrity changed',
  );
  const archive = path.join(root, `archive-${sequence}-${sha256(bytes)}.tgz`);
  writeFileSync(archive, bytes, { mode: 0o600, flag: 'wx' });
  try {
    execFileSync('python3', [
      extractor,
      archive,
      target,
      ...(withoutBundle ? ['--without-bundle'] : []),
    ]);
  } finally {
    rmSync(archive, { force: true });
  }
}
const runtime = path.join(root, 'package');
await extract(policy.distribution.url, policy.distribution.integrity, runtime, true);
const manifestPath = path.join(runtime, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath));
assert.equal(manifest.version, policy.version);
// No runtime range is changed. Test/workspace/lifecycle metadata is not part of
// this private publisher; never install dependencies or run scripts at stage time.
for (const key of ['devDependencies', 'workspaces', 'scripts']) delete manifest[key];
manifest.private = true;
assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
assert.ok(!manifest.overrides && !manifest.resolutions);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(path.join(runtime, 'package-lock.json'), lockBytes);
const entries = Object.entries(lock.packages).filter(([name]) => name);
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < entries.length) {
      const [name, entry] = entries[next++];
      assert.match(
        name,
        /^node_modules\/(?:@[\w.-]+\/)?[\w.-]+(?:\/node_modules\/(?:@[\w.-]+\/)?[\w.-]+)*$/,
      );
      assert.ok(
        !entry.dev && !entry.link && !entry.hasInstallScript,
        'Publisher dependencies must be runtime data only',
      );
      await extract(entry.resolved, entry.integrity, path.join(runtime, name));
    }
  }),
);
const cli = path.join(runtime, policy.distribution.entry);
verifyPublisher(cli, policy, { local });
const output = execFileSync(process.execPath, [cli, '--version'], {
  cwd: root,
  env: {
    PATH: process.env.PATH,
    HOME: root,
    NPM_CONFIG_USERCONFIG: path.join(root, 'empty.npmrc'),
  },
  encoding: 'utf8',
});
assert.equal(output.trim(), policy.version);
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `RELEASE_CLI=${cli}\n`);
console.log(
  `Verified private npm ${policy.version} runtime with locked fixed dependencies: ${cli}`,
);
