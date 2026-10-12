/**
 * Embed, for every knob the colour panel offers, what that token *actually*
 * paints in the installed app — measured, not asserted.
 *
 * Why this exists: a knob's label is a promise about reach, and a token is
 * shared. `--dsw-alias-bg-module-platform` is consumed by the composer, by
 * several card surfaces and by whatever else borrows it; calling the knob
 * "输入框与模块" is a guess about which of those the user will notice. Running the
 * scan turns the guess into evidence the panel can show, and it is how the labels
 * were corrected: every rename in `COLOR_SLOTS` is backed by the selectors this
 * writes out.
 *
 * Three things are collected per token:
 *
 *   - `selectors` — the rules that paint with it, with the bundler's class-name
 *     hash stripped, ranked by how often each appears. This is the useful column:
 *     `composer` and `sessionItem` tell a reader where to look.
 *   - `packages` — how many packages mention it at all, the same figure the
 *     theme-surface report prints.
 *   - `refs` — total mentions, in CSS and in component code.
 *
 * It also writes `TOKEN_SURFACE`, the denominator: how many tokens exist to be
 * adjustable in the first place, so the panel can say "22 of 120" from data
 * rather than from memory.
 *
 * Usage: node analysis/embed-consumers.mjs [--check]
 *   --check  verify the embedded block matches a fresh scan, and write nothing
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ASAR,
  collectCss,
  forEachRule,
  openAsar,
  packageOf,
  readColorSlots,
  readableSelector,
} from './lib/asar-css.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', 'dsh-diy-skin', 'client.js');
const REACH = join(HERE, '..', 'dsh-diy-skin', 'KNOB-REACH.md');
const START = '// @dsd-consumers:start';
const END = '// @dsd-consumers:end';

const slots = readColorSlots(CLIENT);
const wanted = slots.map((slot) => slot.token);

// ------------------------------------------------------------------ scan
const { entries, readEntry } = openAsar(DEFAULT_ASAR);
const cssChunks = collectCss(entries, readEntry);

/** token -> { selectors: Map(selector -> count), packages: Set, refs } */
const found = new Map();
for (const token of wanted) {
  found.set(token, { selectors: new Map(), packages: new Map(), refs: 0 });
}

// 1. CSS rules, so a token can be attributed to a selector rather than a file.
for (const { css, package: pkg } of cssChunks) {
  forEachRule(css, (selector, body) => {
    if (!body.includes('var(--dsw-')) return;
    for (const token of wanted) {
      if (!body.includes('var(' + token + ')')) continue;
      const record = found.get(token);
      const name = readableSelector(selector).slice(0, 56);
      // At-rules (`@media`, `@keyframes`) have nested blocks, so the flat rule
      // scanner sees their prelude — or a fragment of it — as a selector.
      if (name.length < 3 || name.startsWith('@')) continue;
      record.selectors.set(name, (record.selectors.get(name) ?? 0) + 1);
      record.packages.set(pkg, (record.packages.get(pkg) ?? 0) + 1);
      record.refs += 1;
    }
  });
}

// 2. Component code, so a token used from JavaScript still counts towards reach.
for (const [internal, entry] of entries) {
  if (entry.unpacked === true) continue;
  if (!/\.(js|mjs|cjs)$/.test(internal)) continue;
  if (!/dsh-client-ui-|dsh-client-modules|dsh-web-/.test(internal)) continue;
  const text = readEntry(entry).toString('utf8');
  if (!text.includes('--dsw-')) continue;
  for (const token of wanted) {
    let index = 0;
    let hits = 0;
    while ((index = text.indexOf(token, index)) >= 0) {
      hits += 1;
      index += token.length;
    }
    if (hits === 0) continue;
    const record = found.get(token);
    const pkg = packageOf(internal);
    record.packages.set(pkg, (record.packages.get(pkg) ?? 0) + hits);
    record.refs += hits;
  }
}

// 3. The denominator: how much is there to adjust at all.
const everyToken = new Set();
for (const { css } of cssChunks) {
  for (const match of css.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)) everyToken.add(match[1]);
}
const byPrefix = (prefix) => [...everyToken].filter((name) => name.startsWith(prefix)).length;
const literalPackages = new Set();
for (const [internal, entry] of entries) {
  if (entry.unpacked === true) continue;
  // The same rule `theme-surface.mjs` uses, so the two reports cannot disagree
  // about how many packages carry colours a token override can never reach.
  if (!/\.(js|mjs|cjs)$/.test(internal)) continue;
  const text = readEntry(entry).toString('utf8');
  if (/#[0-9a-fA-F]{3,8}\b/.test(text)) literalPackages.add(packageOf(internal));
}

// ------------------------------------------------------------------ emit
const consumers = {};
for (const slot of slots) {
  const record = found.get(slot.token);
  // The plugin's own `--dsd-` tokens have no evidence in the app by design: they
  // exist only in this plugin's stylesheet. Emitting a row of zeroes for them
  // would put "measured 0 places" in a tooltip where the truth is "this one is
  // ours", so they are left out and the panel says so instead.
  if (record.refs === 0) continue;
  const selectors = [...record.selectors.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 4)
    .map(([name]) => name);
  // Where to go and look. A selector list tells a reader who already knows the
  // app what a token paints; a package list tells them which screen to open, which
  // is the question a label like "控件与标签底" actually provokes.
  const packages = [...record.packages.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([name]) => name.replace('@deepseek-ai/dsh-client-ui-', '').replace('@deepseek-ai/dsh-', ''));
  consumers[slot.token] = {
    refs: record.refs,
    packages: record.packages.size,
    selectors,
    seenIn: packages,
  };
}
const surface = {
  adjustable: everyToken.size,
  alias: byPrefix('--dsw-alias-'),
  specific: byPrefix('--dsw-specific-'),
  menu: byPrefix('--dsw-menu-'),
  literalPackages: literalPackages.size,
};

const source = readFileSync(CLIENT, 'utf8');
// Match the file's own line endings. Where client.js has been through Windows
// tooling it is CRLF; where it has not, LF. A block that always wrote LF made
// `--check` report STALE for ever: each run rewrote the region to the other
// ending, and the next run rewrote it back.
const eol = source.includes('\r\n') ? '\r\n' : '\n';
// Only the denominator ships, in the bundle. The per-token table is a
// maintainer's working paper: it is what the knob labels were chosen from, and
// a tooltip is not the place to keep the working out. It goes in KNOB-REACH.md.
const body = [
  START + ' — generated by analysis/embed-consumers.mjs, do not edit by hand',
  '    /** How much there is to adjust at all, so the panel can state its coverage. */',
  '    const TOKEN_SURFACE = {',
  '      adjustable: ' + surface.adjustable + ',',
  '      alias: ' + surface.alias + ',',
  '      specific: ' + surface.specific + ',',
  '      menu: ' + surface.menu + ',',
  '      literalPackages: ' + surface.literalPackages + ',',
  '    };',
  END,
].join(eol);

const from = source.indexOf(START);
const to = source.indexOf(END);
if (from < 0 || to < 0) {
  console.error('the generated block is not in client.js; add the two markers first');
  process.exit(1);
}
const next = source.slice(0, from) + body + source.slice(to + END.length);

/** The table, as a document: what each knob touches, and the evidence for it. */
const doc = [
  '# 每个旋钮实际改到哪里（实测）',
  '',
  '> 由 `analysis/embed-consumers.mjs` 从**已安装的应用**里扫出来，不是凭印象写的。',
  '> 重新生成：`node analysis/embed-consumers.mjs`；只校验：`--check`。',
  '',
  '这份文件是面板里那 22 个旋钮的**依据**：旋钮的名字和「在哪看」都是照着它定的。',
  '面板自己只显示「在哪看」那一行——工具提示不该塞着推导过程，但推导过程不该丢掉。',
  '',
  '| 旋钮 | token | 在哪看 | 改动处数 | 涉及包数 | 采样到的选择器 | 出现在（按引用数） |',
  '|---|---|---|---|---|---|---|',
  ...slots.map((slot) => {
    const record = consumers[slot.token];
    const where = (slot.where ?? '').replace(/\|/g, '\\|');
    if (!record) {
      return `| ${slot.label} | \`${slot.token}\` | ${where} | — | — | 本插件自绘 | — |`;
    }
    const selectors = record.selectors.map((name) => '`' + name + '`').join(' ');
    const seen = record.seenIn.join(' · ');
    return `| ${slot.label} | \`${slot.token}\` | ${where} | ${record.refs} | ${record.packages} | ${selectors} | ${seen} |`;
  }),
  '',
  `官方可调 token 共 ${surface.alias + surface.specific + surface.menu} 个` +
    `（alias ${surface.alias} · specific ${surface.specific} · menu ${surface.menu}）；` +
    `${surface.literalPackages} 个包直接写死了颜色，任何 token 都改不到。`,
  '',
].join('\n');

if (process.argv.includes('--check')) {
  const stale = next !== source;
  const docStale = !existsSync(REACH) || readFileSync(REACH, 'utf8') !== doc;
  console.log(
    !stale && !docStale
      ? 'the generated coverage numbers and KNOB-REACH.md are up to date'
      : 'STALE: ' + (stale ? 'client.js ' : '') + (docStale ? 'KNOB-REACH.md ' : '') + '— re-run without --check',
  );
  process.exit(!stale && !docStale ? 0 : 1);
}

writeFileSync(CLIENT, next);
writeFileSync(REACH, doc);
const evidenced = Object.keys(consumers).length;
console.log(
  `${evidenced} of ${slots.length} tokens have app-side evidence; surface ${surface.adjustable} ` +
    `(alias ${surface.alias}, specific ${surface.specific}, menu ${surface.menu}); ` +
    `${surface.literalPackages} packages carry literal colours`,
);
console.log('wrote ' + REACH);
for (const slot of slots) {
  const record = consumers[slot.token];
  if (!record) {
    console.log('  ' + slot.token.replace('--dsw-', '').padEnd(34) + '   (this plugin only)');
    continue;
  }
  console.log(
    '  ' +
      slot.token.replace('--dsw-', '').padEnd(34) +
      String(record.refs).padStart(4) +
      ' refs  ' +
      String(record.packages).padStart(2) +
      ' pkgs  ' +
      record.selectors.join(' | '),
  );
}
