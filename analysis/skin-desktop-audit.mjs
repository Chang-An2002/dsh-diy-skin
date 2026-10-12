// Read-only audit of the installed dsh-skin-market catalog.
// Answers: which skins can the official Desktop install itself, and what does the
// catalog say about the pinned deep-whale/maid-atelier target?
import { readFileSync } from 'node:fs';

const CATALOG = process.argv[2];
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const skins = catalog.skins;

const modeOf = (s) => s.install?.desktop?.mode ?? '(no desktop block)';
const counts = new Map();
for (const s of skins) counts.set(modeOf(s), (counts.get(modeOf(s)) ?? 0) + 1);

console.log(`catalog schemaVersion=${catalog.schemaVersion} generatedAt=${catalog.generatedAt}`);
console.log(`total skins: ${skins.length}`);
console.log('\n== install.desktop.mode distribution ==');
for (const [mode, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${mode}`);

const managed = skins.filter((s) => s.install?.desktop?.mode === 'managed');
console.log(`\n== Desktop-installable (mode: managed): ${managed.length} ==`);
for (const s of managed) {
  const dsh = s.compatibility?.dsh ?? '?';
  console.log(`  - ${s.id}`);
  console.log(`      zh=${s.name?.zh ?? ''}  package=${s.package ?? '?'}  compat.dsh=${dsh}`);
  console.log(`      target=${s.install?.target ?? '?'}`);
}

const reasons = new Map();
for (const s of skins) {
  const r = s.install?.desktop?.reason;
  if (r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
}
console.log('\n== manual-only reasons ==');
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);

console.log('\n== pinned target in catalog ==');
const target = skins.filter(
  (s) => s.repo === 'https://github.com/Small-tailqwq/dsh-deep-whale' || /maid-atelier|orca-link/.test(s.id),
);
for (const s of target) {
  console.log(`  - ${s.id}  package=${s.package}  rowId=${s.rowId}`);
  console.log(`      name.zh=${s.name?.zh}  compat=${JSON.stringify(s.compatibility)}`);
  console.log(`      install=${JSON.stringify(s.install)}`);
}

// Which catalog entries pin the exact commit the user asked for?
const COMMIT = 'b693d2c224a0a6fb5b621e7cc1284f20d9849c1c';
const pinned = skins.filter((s) => s.install?.commit === COMMIT);
console.log(`\n== entries pinned to ${COMMIT.slice(0, 12)}… : ${pinned.length} ==`);
for (const s of pinned) console.log(`  - ${s.id}  subpath=${s.repo}#${s.subpath ?? ''}  package=${s.package}`);
