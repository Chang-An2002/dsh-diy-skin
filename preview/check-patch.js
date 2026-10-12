// Parse the profile patch with the same YAML library the loader uses, and
// report exactly what an inserted row would resolve to.
const fs = require('fs');
const path = require('path');

const patchPath = process.argv[2];
const jsYamlPath = process.argv[3];

const raw = fs.readFileSync(patchPath);
console.log('bytes        :', raw.length);
console.log('BOM          :', raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf ? 'PRESENT (problem!)' : 'none');
console.log('has CRLF     :', raw.includes(Buffer.from('\r\n')));
console.log('last 24 bytes:', JSON.stringify(raw.subarray(-24).toString('utf8')));

const YAML = require(jsYamlPath);
let parsed;
try {
  parsed = YAML.load(raw.toString('utf8'));
} catch (error) {
  console.error('YAML PARSE FAILED:', error.message);
  process.exit(1);
}

console.log('top-level entries:', Array.isArray(parsed) ? parsed.length : typeof parsed);
parsed.forEach((entry, index) => {
  const label = entry.id ? `id=${entry.id}` : entry.insert ? 'insert' : '?';
  console.log(`  [${index}] ${label}`);
  for (const row of entry.insert || []) {
    const name = row.name;
    const isAbs = path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name);
    console.log(`        row id=${row.id} name=${name}`);
    console.log(`        absolute path? ${isAbs}`);
    if (isAbs) {
      // A row may name a package directory or an entry file. The loader imports
      // it as-is, and ESM refuses a directory import, so report which one this
      // is; then locate the manifest the way client-modules does (walk upward).
      const stat = fs.existsSync(name) ? fs.statSync(name) : undefined;
      const kind = stat ? (stat.isDirectory() ? 'directory' : 'file') : 'MISSING';
      console.log(`        target: ${kind}`);
      if (kind === 'directory') {
        console.log('        NOTE: ESM cannot import a directory — this row will not mount');
      }
      let search = stat && stat.isDirectory() ? name : path.dirname(name);
      let pkgJson;
      while (search && search !== path.dirname(search)) {
        const candidate = path.join(search, 'package.json');
        if (fs.existsSync(candidate)) { pkgJson = candidate; break; }
        search = path.dirname(search);
      }
      console.log(`        package.json found? ${pkgJson || 'no'}`);
      if (pkgJson) {
        const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
        const clientRel = pkg.exports && pkg.exports['./client'];
        const clientPath = clientRel ? path.join(path.dirname(pkgJson), clientRel) : undefined;
        console.log(`        resolved package: ${pkg.name}@${pkg.version}`);
        console.log(`        dsh.client: ${JSON.stringify(pkg.dsh && pkg.dsh.client)}`);
        console.log(
          `        client bundle: ${clientRel} ${clientPath && fs.existsSync(clientPath) ? '(exists)' : '(MISSING)'}`,
        );
      }
    }
  }
});

// Show what the loader turns an absolute name into.
const row = parsed.flatMap((e) => e.insert || []).find((r) => r.id === 'deepseek-decor');
if (row) {
  const { pathToFileURL } = require('url');
  console.log('\nloader would import:', pathToFileURL(path.resolve(row.name)).href);
}
