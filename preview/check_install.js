// Pre-restart integrity check for the installed plugin package.
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2]);
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const has = (rel) => fs.existsSync(path.join(dir, rel));

console.log('package      :', pkg.name, pkg.version);
console.log('private      :', pkg.private === true);
console.log('host entry   :', pkg.exports['.'], has('index.js') ? '(present)' : '(MISSING)');
console.log('client entry :', pkg.exports['./client'], has('client.js') ? '(present)' : '(MISSING)');
console.log('patch file   :', pkg.dsh.bundle.patch, has('cordis.patch.yml') ? '(present)' : '(MISSING)');
console.log('dependencies :', JSON.stringify(pkg.dependencies || {}));
console.log('client decl  :', JSON.stringify(pkg.dsh.client));

const src = fs.readFileSync(path.join(dir, 'client.js'), 'utf8');
const idMatch = /id:\s*'([^']+)'/.exec(src);
console.log('loader call  :', /window\.__ModuleLoader__\.load\(/.test(src) ? 'ok' : 'BAD');
console.log('module id    :', idMatch ? idMatch[1] : 'NOT FOUND');
const artworkBlock = /@dsd-artwork:start([\s\S]*?)@dsd-artwork:end/.exec(src);
console.log('artwork baked:', artworkBlock && artworkBlock[1].includes('data:image/webp;base64,')
  ? `yes (${Math.round(src.length / 1024)} KB bundle)` : 'NO');
for (const key of ['chibi', 'portrait', 'meme']) {
  // The artwork constant is spliced in as `key:` followed by a data URI literal.
  const re = new RegExp('\\n\\s+' + key + ':\\s*\\n\\s+\'data:image/webp;base64,');
  console.log('  ' + key.padEnd(9) + ':', re.test(src) ? 'data URI present' : 'MISSING');
}

// The host half must not import anything: a missing dependency would stop the
// whole profile from booting.
const host = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
const imports = [...host.matchAll(/^\s*import\s.+?from\s+'([^']+)'/gm)].map((m) => m[1]);
console.log('host imports :', imports.length === 0 ? 'none (dependency-free)' : imports.join(', '));
console.log('host apply   :', /export function apply\s*\(/.test(host) ? 'exported' : 'MISSING');
