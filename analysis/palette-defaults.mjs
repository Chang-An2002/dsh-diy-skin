/**
 * Read the *effective* value of a set of `--dsw-*` tokens, in both colour
 * schemes, out of the installed app.
 *
 * Why this exists: the colour column in the decoration plugin has to show a real
 * default for every knob it offers, and those defaults must survive being used
 * as the other scheme's value when the user only edits one scheme. Typing them
 * in by hand is how a palette drifts from the app it claims to describe, so the
 * value is read from the shipped CSS instead.
 *
 * Differences from `analysis/theme-surface.mjs`, which shares the source:
 *
 *   - light/dark is decided by the rule a declaration sits in, not by its
 *     position in the file. The older scanner flips a `mode` flag at the first
 *     `[data-ds-dark-theme]` and never flips back, which is fine for a
 *     "what value did the author write" inventory and wrong for this.
 *   - the palettes of every chunk are unioned, so a token declared only in one
 *     package is still found.
 *   - `var()` chains are resolved, because a usable default is a colour, not the
 *     name of another token.
 *
 * Usage:
 *   node analysis/palette-defaults.mjs                 # the plugin's slot list
 *   node analysis/palette-defaults.mjs --token=--dsw-alias-bg-base
 *   node analysis/palette-defaults.mjs --all           # every resolvable token
 */
import { openSync, readFileSync, readSync } from 'node:fs';

const ASAR =
  process.env.DSH_ASAR ??
  'C:\\Users\\pipi0\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';

// ------------------------------------------------------------------ asar read
const fd = openSync(ASAR, 'r');
const pre = Buffer.alloc(16);
readSync(fd, pre, 0, 16, 0);
const stringLen = pre.readUInt32LE(4);
const raw = Buffer.alloc(stringLen);
readSync(fd, raw, 0, stringLen, 12);
let headerText = raw.subarray(4).toString('utf8');
headerText = headerText.slice(0, headerText.lastIndexOf('}') + 1);
const header = JSON.parse(headerText);
const BASE = 12 + stringLen;

const entries = [];
(function walk(node, prefix) {
  if (!node.files) return;
  for (const [name, entry] of Object.entries(node.files)) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) walk(entry, p);
    else entries.push([p, entry]);
  }
})(header, '');

function readEntry(entry) {
  const buf = Buffer.alloc(entry.size);
  readSync(fd, buf, 0, entry.size, BASE + Number(entry.offset));
  return buf;
}

// --------------------------------------------------------------- css gathering
/**
 * Every long string literal in a bundle is a candidate CSS chunk; the shipped
 * packages inline their stylesheets as `var x = "<css>"`.
 */
const cssChunks = [];
for (const [path, entry] of entries) {
  if (entry.unpacked === true) continue;
  if (!/\.(js|mjs|cjs)$/.test(path)) continue;
  if (!/dsh-client-ui-|dsh-client-modules/.test(path)) continue;
  const text = readEntry(entry).toString('utf8');
  for (const match of text.matchAll(/=\s*"((?:[^"\\]|\\.){120,})"/g)) {
    const css = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    if (css.includes('--dsw-')) cssChunks.push({ path, css });
  }
}
// The theme package owns the palette, so its declarations are read first and the
// first value seen per scheme wins. Any other package that declares a global
// token only fills a gap the theme package left.
cssChunks.sort(
  (a, b) =>
    Number(!a.path.includes('dsh-client-ui-theme')) -
    Number(!b.path.includes('dsh-client-ui-theme')),
);

/**
 * A rule that declares a token for the whole document. Component-scoped rules
 * (anything with a class or id) re-point a global name for one subtree only, so
 * they describe a local override rather than the palette.
 */
const GLOBAL_SELECTOR = /^(?::root|html|body)(?:\s*\[[^\]]*\])*$/;

/** `selector{declarations}` — these bundles contain no nested rules. */
function forEachRule(css, visit) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(css))) visit(match[1].trim(), match[2]);
}

function declarationsOf(body) {
  const out = [];
  for (const piece of body.split(';')) {
    const at = piece.indexOf(':');
    if (at < 0) continue;
    const name = piece.slice(0, at).trim();
    if (!name.startsWith('--')) continue;
    out.push([name, piece.slice(at + 1).trim()]);
  }
  return out;
}

/** name -> { light?, dark? }; the first declaration per scheme wins. */
const palette = new Map();
/** Every global declaration, in read order, for `--where`. */
const history = new Map();
let chunks = 0;
for (const { path, css } of cssChunks) {
  chunks += 1;
  forEachRule(css, (selector, body) => {
    // Only rules that declare a token for the whole document count. A component
    // stylesheet may re-point a global name at a different colour for its own
    // subtree — `plugin-manager` does exactly that for
    // `--dsw-alias-button-primary-fill` inside its danger button — and that is a
    // local override, not the value the rest of the app sees.
    if (!GLOBAL_SELECTOR.test(selector)) return;
    const dark = /\[data-ds-dark-theme\]/.test(selector);
    for (const [name, value] of declarationsOf(body)) {
      const record = palette.get(name) ?? {};
      if (!record[dark ? 'dark' : 'light']) record[dark ? 'dark' : 'light'] = value;
      palette.set(name, record);
      if (!history.has(name)) history.set(name, []);
      history.get(name).push({ scheme: dark ? 'dark' : 'light', selector, value, path });
    }
  });
}

// --------------------------------------------------------------- var resolving
const VAR = /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/i;

/**
 * Resolve `var()` references against the palette. A `color-mix()` or a gradient
 * is returned as written: it is a legitimate CSS value, just not a colour this
 * tool can reduce to a hex, and the caller has to cope with that either way.
 */
function resolve(value, scheme, depth = 0) {
  if (typeof value !== 'string' || depth > 10) return value;
  if (!value.includes('var(')) return value;
  const next = value.replace(new RegExp(VAR, 'gi'), (whole, name, fallback) => {
    const record = palette.get(name);
    const found = record ? record[scheme] ?? record.light ?? record.dark : undefined;
    if (found === undefined) return fallback === undefined ? whole : fallback.trim();
    return resolve(found, scheme, depth + 1);
  });
  return next === value ? value : resolve(next, scheme, depth + 1);
}

// ------------------------------------------------------------------ the report
/**
 * The plugin's own tables, read out of the shipped source.
 *
 * The knob list and the two hex columns next to each knob are hand-written in
 * `client.js`, and a wrong entry there is invisible: the swatch simply shows a
 * colour the app no longer paints. Reading them back here is what turns "I think
 * that is the value" into a check, and it is why this file does not carry its own
 * copy of the list.
 */
const CLIENT = new URL('../dsh-diy-skin/client.js', import.meta.url);
const client = readFileSync(CLIENT, 'utf8');

/** The body of one `const NAME = [ ... ];` or `const NAME = { ... };` literal. */
function literalBody(name) {
  const head = new RegExp('const ' + name + ' = ([\\[{])');
  const match = head.exec(client);
  if (!match) throw new Error('client.js no longer declares ' + name);
  const closer = match[1] === '[' ? ']' : '}';
  const end = client.indexOf('\n    ' + closer + ';', match.index);
  if (end < 0) throw new Error('could not find the end of ' + name);
  return client.slice(match.index, end);
}

const slots = [];
for (const line of literalBody('COLOR_SLOTS').split('\n')) {
  const match =
    /key:\s*'([^']+)'.*?group:\s*'([^']+)'.*?label:\s*'([^']+)'.*?token:\s*'(--[a-z0-9-]+)'.*?light:\s*'(#[0-9a-f]+)'.*?dark:\s*'(#[0-9a-f]+)'/.exec(
      line,
    );
  if (match) {
    slots.push({ key: match[1], group: match[2], label: match[3], token: match[4], light: match[5], dark: match[6] });
  }
}

/** `--token: { light: '#..', dark: '#..' }` pairs from one override layer. */
function layerTokens(name) {
  const out = new Map();
  for (const line of literalBody(name).split('\n')) {
    const match = /'(--[a-z0-9-]+)':\s*\{\s*light:\s*'([^']+)',\s*dark:\s*'([^']+)'\s*\}/.exec(line);
    if (match) out.set(match[1], { light: match[2], dark: match[3] });
  }
  return out;
}

const brand = layerTokens('BRAND_TOKENS');
const material = layerTokens('MATERIAL_TOKENS');
const chrome = layerTokens('CHROME_TOKENS');
/**
 * What this app actually paints, with the plugin loaded.
 *
 * Three sources, in stacking order. `chrome` is what makes the `--dsd-` knobs
 * checkable at all: those tokens are the plugin's own and are *not supposed to
 * exist* in the app's stylesheets, so the app-side lookup legitimately finds
 * nothing for them and the plugin's own layer is the only authority on their
 * value. Reporting them as "not declared" would train the reader to ignore the
 * one line that matters.
 */
const pluginValue = (token) => brand.get(token) ?? material.get(token) ?? chrome.get(token) ?? null;
const pluginOwned = (token) => token.startsWith('--dsd-');

const SLOT_TOKENS = slots.map((slot) => slot.token);

const argv = process.argv.slice(2);
const explicit = argv
  .filter((a) => a.startsWith('--token='))
  .map((a) => a.slice('--token='.length));
const wanted = argv.includes('--all')
  ? [...palette.keys()].sort()
  : explicit.length > 0
    ? explicit
    : SLOT_TOKENS;

console.log(`chunks scanned: ${cssChunks.length} (${chunks} rulesets), tokens seen: ${palette.size}`);
if (argv.includes('--where')) {
  for (const name of wanted) {
    console.log(`\n${name}`);
    for (const hit of history.get(name) ?? []) {
      console.log(`  [${hit.scheme}] ${hit.selector}  ->  ${hit.value}`);
      console.log(`         ${hit.path}`);
    }
  }
  process.exit(0);
}

if (explicit.length === 0 && !argv.includes('--all')) {
  // ------------------------------------------------- the knob table, cross-checked
  console.log(`\nknobs declared in client.js: ${slots.length}\n`);
  const header = ['knob', 'token', 'scheme', 'knob says', 'app paints', 'source', 'ok'];
  const rows = [];
  let mismatched = 0;
  let undeclared = 0;
  for (const slot of slots) {
    const record = palette.get(slot.token);
    const mine = pluginOwned(slot.token);
    if (!record && !mine) undeclared += 1;
    for (const scheme of ['light', 'dark']) {
      const stock = record && record[scheme] ? resolve(record[scheme], scheme) : null;
      // A token the plugin itself overrides is *meant* to differ from the stock
      // palette; the knob's default has to match whichever value actually paints.
      const override = pluginValue(slot.token);
      const expected = override ? override[scheme] : stock;
      const claimed = slot[scheme];
      const ok = expected !== null && expected.toLowerCase() === claimed.toLowerCase();
      if (!ok) mismatched += 1;
      const source = mine
        ? 'plugin layer'
        : override
          ? 'plugin override'
          : record
            ? 'stock palette'
            : 'NOT DECLARED';
      rows.push([
        slot.label,
        slot.token,
        scheme,
        claimed,
        expected ?? '(none)',
        source,
        ok ? 'ok' : 'DIFFERS',
      ]);
    }
  }
  const width = (index) => Math.max(...rows.map((row) => String(row[index]).length), header[index].length);
  const widths = header.map((_, index) => width(index));
  const line = (row) =>
    row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ').trimEnd();
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
  const owned = slots.filter((slot) => pluginOwned(slot.token)).length;
  console.log(
    `\n${rows.length} values checked: ${rows.length - mismatched} match, ${mismatched} differ` +
      (undeclared > 0 ? `, ${undeclared} token(s) not declared in the app` : '') +
      `\n${slots.length - owned} knobs drive the app's own tokens, ${owned} drive tokens this plugin owns`,
  );
  process.exit(mismatched === 0 && undeclared === 0 ? 0 : 1);
}

for (const name of wanted) {
  const record = palette.get(name);
  if (!record) {
    console.log(`${name}: NOT DECLARED`);
    continue;
  }
  const light = record.light ? resolve(record.light, 'light') : '(absent)';
  const dark = record.dark ? resolve(record.dark, 'dark') : '(absent)';
  console.log(`${name}\n  light ${light}\n  dark  ${dark}`);
}
