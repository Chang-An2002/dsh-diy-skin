// Reproduce what the Loader does with our row: import the host half from the
// same file:// specifier the loader derives, and resolve the client bundle the
// way client-modules would (exports["./client"] next to the located package).
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const dir = process.argv[2];
// Two candidate specifiers: the bare directory (what a package manager would
// install) and the entry file. ESM rejects the former, so the loader row must
// name a file.
const candidates = [pathToFileURL(dir).href, pathToFileURL(join(dir, 'index.js')).href];

let mod;
let used;
for (const url of candidates) {
  console.log('loader specifier :', url);
  try {
    mod = await import(url);
    used = url;
    console.log('host import      : OK');
    break;
  } catch (error) {
    console.log('host import      : FAILED — ' + error.message.split('\n')[0]);
  }
}
if (!mod) process.exit(1);
void used;

console.log('exports          :', Object.keys(mod).join(', '));
console.log('apply is function:', typeof mod.apply === 'function');

// The loader also validates a Config export when the package provides one.
if ('Config' in mod) console.log('Config export    :', typeof mod.Config);
else console.log('Config export    : absent (fine)');

const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const clientRel = pkg.exports['./client'];
const clientPath = join(dir, clientRel);
console.log('client bundle    :', clientRel, existsSync(clientPath) ? '(exists)' : '(MISSING)');

const client = readFileSync(clientPath, 'utf8');
const idMatch = /id:\s*'([^']+)'/.exec(client);
console.log('client module id :', idMatch ? idMatch[1] : 'NOT FOUND');
console.log('id === package   :', idMatch && idMatch[1] === pkg.name);

// client-modules rejects a declaration whose platform is not exactly "web".
console.log('platform         :', JSON.stringify(pkg.dsh.client.platform));
console.log('platform is web  :', pkg.dsh.client.platform === 'web');

// Every declared inject entry must be a client row that the boot manifest
// advertises, otherwise wire composition rejects the graph.
const bootJson = process.argv[3];
if (bootJson && existsSync(bootJson)) {
  const boot = JSON.parse(readFileSync(bootJson, 'utf8'));
  const ids = new Set(boot.entries.map((e) => e.id));
  console.log('\nboot entries     :', ids.size);
  for (const dep of pkg.dsh.client.inject) {
    console.log('  inject ' + dep.padEnd(42) + (ids.has(dep) ? 'present' : 'MISSING FROM BOOT GRAPH'));
  }
  console.log('  our own id present:', ids.has(pkg.name));
}
