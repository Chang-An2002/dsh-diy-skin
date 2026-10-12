/**
 * Is this package ready to be published as a DSH plugin? And if the name is the
 * only thing in the way, do the rename.
 *
 * The point of the file is that "ready to publish" is a list, and a list that
 * lives in someone's head is a list that gets skipped. Every item here is
 * mechanical and checkable:
 *
 *   - the four places the package name appears must agree, because the client
 *     bundle registers itself with the module loader under that exact id and a
 *     mismatch is a plugin that silently never mounts;
 *   - no `@deepseek-ai/*` dependency may appear. `@deepseek-ai/schemastery` is not
 *     published beside the DSH installation, so declaring it sends the profile's
 *     package manager to the registry for a version that may not match, and a
 *     broken profile dependency stops the whole profile from booting;
 *   - the `files` allowlist must cover every runtime file and must not ship the
 *     test suite, the design scripts or the preview tooling;
 *   - nothing may leak an absolute path from the machine it was developed on;
 *   - the test count quoted in the README must match the test file, because that
 *     number is the only claim in the docs that a reader cannot verify by reading;
 *
 * Usage:
 *   node analysis/pubcheck.mjs                 # report; exit 1 on a structural fault
 *   node analysis/pubcheck.mjs --strict        # gate for the actual publish
 *   node analysis/pubcheck.mjs --rename <name> # do the rename and print the rest
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', 'dsh-diy-skin');
const MANIFEST = join(ROOT, 'package.json');

/** Files rewritten by `--rename`, in the order a reader would think of them. */
const RENAME_TARGETS = [
  'package.json',
  'client.js',
  'cordis.patch.yml',
  'index.js',
  'test/client.test.mjs',
  'README.md',
  'THEME-SURFACE.md',
  '../analysis/plugin-guards.mjs',
];

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

let faults = 0;
let blockers = 0;
const ok = (message) => console.log('  ok    ' + message);
const bad = (message) => {
  faults += 1;
  console.log('  FAULT ' + message);
};
/** Fine for development, must be cleared before `npm publish`. */
const pending = (message, fix) => {
  blockers += 1;
  console.log('  todo  ' + message + (fix ? '\n          → ' + fix : ''));
};

// ------------------------------------------------------------------ manifest
if (!existsSync(MANIFEST)) {
  console.error('no package.json at ' + MANIFEST);
  process.exit(1);
}
const raw = readFileSync(MANIFEST);
if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
  bad('package.json starts with a UTF-8 BOM; JSON.parse will throw on it');
}
const manifest = JSON.parse(raw.toString('utf8'));

// ------------------------------------------------------------- the rename
const renameAt = process.argv.indexOf('--rename');
if (renameAt >= 0) {
  const next = process.argv[renameAt + 1] ?? '';
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(next)) {
    console.error('"' + next + '" is not a usable npm package name');
    console.error('usage: node analysis/pubcheck.mjs --rename dsh-diy-skin');
    process.exit(2);
  }
  const previous = manifest.name;
  if (previous === next) {
    console.log('already called ' + next + '; nothing to do');
    process.exit(0);
  }
  for (const relative of RENAME_TARGETS) {
    const path = join(ROOT, relative);
    if (!existsSync(path)) {
      console.log('  skip  ' + relative + ' (absent)');
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const hits = text.split(previous).length - 1;
    if (hits === 0) {
      console.log('  skip  ' + relative + ' (no occurrence)');
      continue;
    }
    writeFileSync(path, text.split(previous).join(next));
    console.log('  wrote ' + relative + ' (' + hits + ')');
  }
  // The bundle id is also baked into the client file's own header comment.
  const leftover = RENAME_TARGETS.filter((relative) => {
    const path = join(ROOT, relative);
    return existsSync(path) && readFileSync(path, 'utf8').includes(previous);
  });
  console.log('\nrenamed ' + previous + ' → ' + next);
  if (leftover.length > 0) console.log('still mentions ' + previous + ': ' + leftover.join(', '));
  console.log(`
Two things this cannot do for you, because they live outside the repository:

1. The profile that installs it. In ~/.dsh/profiles/desktop/package.json, the
   dependency key and the "bundles" entry both carry the old name. The installed
   plugin keeps working only after they are updated — the simplest route is the
   sidebar 插件 panel: remove this plugin, then add the folder again.
2. The running app has to be restarted; the client bundle is read at boot.

Then: node analysis/pubcheck.mjs --strict`);
  process.exit(0);
}

console.log('=== name agreement ===');
const publishableName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(manifest.name);
if (!publishableName) {
  bad('"' + manifest.name + '" is not a usable npm package name');
} else if (manifest.name.startsWith('@local/')) {
  pending(
    'the name is ' + manifest.name + ', which is a local placeholder',
    'node analysis/pubcheck.mjs --rename <your-package-name>',
  );
} else {
  ok('name ' + manifest.name + ' is publishable');
}

/** Every place the package id is written down, and what each one must equal. */
const idSites = [
  ['client.js module-loader id', /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/, 'client.js'],
  ['client.js PLUGIN_ID', /const PLUGIN_ID = '([^']+)'/, 'client.js'],
  ['cordis.patch.yml plugin row', /name:\s*'([^']+)'/, 'cordis.patch.yml'],
];
for (const [what, pattern, file] of idSites) {
  const found = pattern.exec(read(file));
  if (!found) bad('could not find the package id in ' + what);
  else if (found[1] !== manifest.name) {
    bad(what + ' is "' + found[1] + '" but the manifest says "' + manifest.name + '"');
  } else ok(what + ' agrees');
}

console.log('\n=== dependencies ===');
const deps = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies };
const names = Object.keys(deps);
if (names.length === 0) ok('declares no dependencies at all');
else for (const name of names) {
  if (name.startsWith('@deepseek-ai/')) {
    bad(name + ' is a Harness-internal package; it is not published beside the install');
  } else pending(name + ' will be installed from the registry', 'only declare what is really on npm');
}

console.log('\n=== the client half ===');
const client = manifest.dsh?.client;
if (!client) bad('dsh.client is missing: the bundle would have no browser half');
else {
  if (client.platform !== 'web') bad('dsh.client.platform is "' + client.platform + '"');
  else ok('declares a web client half');
  if (client.immediately !== true) pending('dsh.client.immediately is not true', 'the palette would land after a flash');
  else ok('mounts immediately, so the palette is applied before first paint');
  for (const injected of client.inject ?? []) {
    if (injected.startsWith('@deepseek-ai/')) ok('waits for ' + injected);
    else bad(injected + ' is not a Harness service');
  }
}
if (!manifest.dsh?.bundle?.patch) bad('dsh.bundle.patch is missing: the loader has nothing to insert');
else if (!existsSync(join(ROOT, manifest.dsh.bundle.patch))) bad('dsh.bundle.patch points at a file that is not there');
else ok('the bundle patch is present');

console.log('\n=== what ships ===');
const listed = manifest.files ?? [];
if (listed.length === 0) bad('no "files" allowlist: everything in the directory would be published');
else {
  /** The files the runtime needs; a missing one is a plugin that cannot mount. */
  const required = ['client.js', 'index.js', 'icon.svg', 'cordis.patch.yml', 'README.md'];
  for (const file of required) {
    if (!listed.includes(file)) bad(file + ' is required at runtime but is not in "files"');
    else if (!existsSync(join(ROOT, file))) bad(file + ' is listed but does not exist');
  }
  for (const file of listed) {
    if (!existsSync(join(ROOT, file))) bad(file + ' is listed but does not exist');
  }
  for (const never of ['test', 'preview', 'analysis']) {
    if (listed.some((entry) => entry.startsWith(never))) bad(never + '/ must not be published');
  }
  if (faults === 0) ok(listed.length + ' entries, all present: ' + listed.join(' '));
}

console.log('\n=== nothing from this machine ===');
/**
 * An absolute path from whatever machine this was developed on.
 *
 * `[\\/]{1,2}` rather than a literal separator: a Windows path can be written
 * with one backslash, two (in JSON, because a backslash has to be escaped), or a
 * forward slash, and an earlier version of this check only matched the escaped
 * form — so it would have walked straight past the real thing.
 *
 * This scan reads documentation too, which means the prose explaining the check
 * must not contain an example of a banned path. It did, once.
 */
const DEV_PATH = /[A-Za-z]:[\\/]{1,2}(?:Users|Documents|Desktop|develop|dev|projects|src)[\\/]/i;
for (const file of listed.filter((entry) => /\.(js|json|yml|md)$/.test(entry))) {
  if (DEV_PATH.test(read(file))) bad(file + ' contains an absolute path from a development machine');
}
if (faults === 0) ok('no development paths in the shipped files');

console.log('\n=== the documentation ===');
const testSource = read('test/client.test.mjs');
const testCount = (testSource.match(/^test\(/gm) ?? []).length;
const readme = read('README.md');
// The design record is a second document now, and the four quoted numbers moved with
// it — so the checks read both, or they would pass by finding nothing.
const docs = readme + '\n' + read('DESIGN.md');
const quoted = /(\d+)\/(\d+) 通过/.exec(docs);
if (!quoted) pending('the README does not quote a test count');
else if (Number(quoted[2]) !== testCount) {
  bad('the README says ' + quoted[2] + ' tests but the file has ' + testCount);
} else ok('the README quotes ' + testCount + ' tests and there are ' + testCount);

/**
 * The other numbers the README quotes, checked against the code that decides them.
 *
 * These drift the same way the test count does — silently, and in the direction of
 * being wrong about the very thing a reader is trying to judge. The bundle size had
 * three different figures in this file at one point, and the picture cap was quoted
 * as eight for two rounds after it became sixteen. A number in prose with no check
 * behind it is a number that will be wrong; the fix is not care, it is a check.
 */
const clientSource = read('client.js');
const realSize = Math.round(statSync(join(ROOT, 'client.js')).size / 1024);
const sizeClaims = [...docs.matchAll(/`client\.js`[^。\n]*?约\s*\*\*(\d+)\s*KB\*\*/g)].map((m) =>
  Number(m[1]),
);
if (sizeClaims.length === 0) pending('the README quotes no bundle size');
else if (sizeClaims.some((claim) => Math.abs(claim - realSize) > 5)) {
  bad(
    'the README quotes ' +
      sizeClaims.join('/') +
      ' KB for client.js; it is ' +
      realSize +
      ' KB',
  );
} else ok('the README quotes client.js at ' + realSize + ' KB and it is');

const slotsBody = /const COLOR_SLOTS = \[([\s\S]*?)\n    \];/.exec(clientSource);
const slotCount = slotsBody ? (slotsBody[1].match(/\bkey: '/g) ?? []).length : 0;
// A count of *values* (`16 个旋钮值由 presetPalette() 推导`) is a different claim
// from the number of knobs, and it is allowed to differ.
const slotClaims = [...docs.matchAll(/(\d+)\s*个旋钮(?!值)/g)].map((m) => Number(m[1]));
if (!slotsBody) pending('cannot count COLOR_SLOTS');
else if (slotClaims.length === 0) pending('the README quotes no knob count');
else if (slotClaims.some((claim) => claim !== slotCount)) {
  bad('the README quotes ' + slotClaims.join('/') + ' knobs; COLOR_SLOTS has ' + slotCount);
} else ok('the README quotes ' + slotCount + ' knobs and COLOR_SLOTS has ' + slotCount);

const capMatch = /const BACKGROUND_MAX_ITEMS = (\d+);/.exec(clientSource);
const capClaims = [
  ...docs.matchAll(/最多\s*\*{0,2}(\d+)\s*张/g),
  ...docs.matchAll(/含壁纸在内的\s*(\d+)\s*张/g),
].map((m) => Number(m[1]));
if (!capMatch) pending('cannot read BACKGROUND_MAX_ITEMS');
else if (capClaims.length === 0) pending('the README quotes no picture cap');
else if (capClaims.some((claim) => claim !== Number(capMatch[1]))) {
  bad(
    'the README quotes a cap of ' + capClaims.join('/') + '; BACKGROUND_MAX_ITEMS is ' + capMatch[1],
  );
} else ok('the README quotes a cap of ' + capMatch[1] + ' pictures and that is the constant');

if (!existsSync(join(ROOT, 'LICENSE'))) pending('no LICENSE file', 'pick one and add it');
else if (!manifest.license) bad('a LICENSE file exists but package.json declares no license');
else ok('LICENSE + "' + manifest.license + '" in the manifest');
if (!manifest.description) pending('no description');
if ((manifest.keywords ?? []).length === 0) pending('no keywords; the plugin list has nothing to search');
if (!manifest.repository) pending('no repository field', 'npm shows a bare page without it');
if (manifest.private === true) pending('"private": true blocks publishing', 'remove it on the release commit');

const dirSize = statSync(join(ROOT, 'client.js')).size;
console.log('\nclient.js is ' + Math.round(dirSize / 1024) + ' KB of the tarball, most of it embedded pictures');

console.log(
  '\n' +
    (faults === 0 ? 'no structural faults' : faults + ' structural fault(s)') +
    '; ' +
    blockers +
    ' item(s) outstanding before the first publish',
);
process.exit(faults > 0 || (process.argv.includes('--strict') && blockers > 0) ? 1 : 0);
