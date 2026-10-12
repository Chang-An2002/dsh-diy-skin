// Show the value chain behind the tokens that set the UI's overall tone.
const fs = require('fs');
const text = fs.readFileSync(process.argv[2], 'utf8');

function statics(name) {
  const re = new RegExp('\\' + name + ':\\s*([^;}"]+)', 'g');
  return [...new Set([...text.matchAll(re)].map((m) => m[1].trim()))];
}
function alias(name) {
  const re = new RegExp('\\' + name + ':\\s*([^;}"]+)', 'g');
  return [...new Set([...text.matchAll(re)].map((m) => m[1].trim()))];
}

const names = [
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-text',
  '--dsw-alias-brand-primary-invert',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-bg-base',
];
console.log('=== alias tokens (light | dark) ===');
for (const n of names) {
  console.log(n.padEnd(42), alias(n).join('   |   ') || '(not declared)');
}

console.log('\n=== the statics brand-primary points at ===');
for (const n of [
  '--dsw-static-neutral-bluish-1000',
  '--dsw-static-neutral-bluish-50',
  '--dsw-static-deepseek-500',
  '--dsw-static-deepseek-400',
]) {
  console.log(n.padEnd(42), statics(n).join(' ') || '(not declared)');
}

// Which token does the composer's send button use? Find its class rule.
console.log('\n=== who consumes brand-primary in the client bundles ===');
const dir = process.argv[3];
if (dir && fs.existsSync(dir)) {
  for (const file of fs.readdirSync(dir)) {
    const p = require('path').join(dir, file);
    if (!fs.statSync(p).isFile() || !file.endsWith('.js')) continue;
    const src = fs.readFileSync(p, 'utf8');
    const hits = (src.match(/--dsw-alias-brand-primary\b/g) || []).length;
    const btn = (src.match(/--dsw-alias-button-primary-fill\b/g) || []).length;
    if (hits || btn) console.log(`${file}: brand-primary x${hits}, button-primary-fill x${btn}`);
  }
}
