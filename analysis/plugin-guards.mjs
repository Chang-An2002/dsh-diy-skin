/**
 * Two static guards on the plugin's browser half that `node --check` cannot
 * express.
 *
 * Both exist because they have already bitten once:
 *
 *  1. `STYLE_TEXT` is a template literal, so a backtick or a `${` anywhere
 *     inside it — including inside a CSS comment — silently ends the string and
 *     produces a syntax error a long way from the edit that caused it.
 *  2. `package.json` shipped once with a UTF-8 BOM, which made `JSON.parse`
 *     throw and the whole profile fail to resolve the plugin.
 *
 * Usage: node analysis/plugin-guards.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readColorSlots } from './lib/asar-css.mjs';
import { frozenBlues } from './blue-audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'dsh-diy-skin');

let failed = 0;
const check = (ok, message) => {
  if (!ok) failed += 1;
  console.log((ok ? 'ok   ' : 'FAIL ') + message);
};

// ------------------------------------------------------------------ STYLE_TEXT
const client = readFileSync(join(root, 'client.js'), 'utf8');
const opener = 'const STYLE_TEXT = ' + String.fromCharCode(96);
const start = client.indexOf(opener);
check(start >= 0, 'STYLE_TEXT is declared as a template literal');
if (start >= 0) {
  const from = start + opener.length;
  const end = client.indexOf(String.fromCharCode(96) + ';', from);
  check(end > from, 'STYLE_TEXT is terminated by a backtick-semicolon');
  if (end > from) {
    const css = client.slice(from, end);
    check(
      !css.includes(String.fromCharCode(96)),
      'no stray backtick inside STYLE_TEXT (' + css.length + ' chars)',
    );
    check(!css.includes('${'), 'no interpolation sequence inside STYLE_TEXT');
    // Braces must balance, or a rule has been left open and every later rule
    // lands inside it.
    let depth = 0;
    for (const character of css) {
      if (character === '{') depth += 1;
      if (character === '}') depth -= 1;
      if (depth < 0) break;
    }
    check(depth === 0, 'STYLE_TEXT braces balance (depth ' + depth + ')');
    for (const selector of ['.dsd-editor-body', '.dsd-pane', '.dsd-color-row', '.dsd-color-scheme']) {
      check(css.includes(selector + '{'), 'STYLE_TEXT styles ' + selector);
    }
  }
}

// ------------------------------------------------------- generated evidence
//
// Two generated artefacts, checked for different reasons:
//
//   - the coverage numbers in the bundle feed a line in the panel, so a stale
//     block means the panel quotes a count that is no longer true;
//   - KNOB-REACH.md is the working paper the knob labels were chosen from. It
//     ships, so a reader can check a label's claim — and it is only worth
//     shipping if it is current.
const consumersStart = '// @dsd-consumers:start';
const consumersEnd = '// @dsd-consumers:end';
check(
  client.includes(consumersStart) && client.includes(consumersEnd),
  'the generated coverage block is present',
);
if (client.includes(consumersStart) && client.includes(consumersEnd)) {
  const block = client.slice(client.indexOf(consumersStart), client.indexOf(consumersEnd));
  const surface = /adjustable: (\d+)/.exec(block);
  check(surface !== null && Number(surface[1]) > 0, 'TOKEN_SURFACE carries a real count');
  // The per-token table belongs in the document, not in every user's bundle.
  check(
    !/TOKEN_CONSUMERS/.test(block),
    'the reach table is not shipped in the bundle any more',
  );
}

const reachPath = join(root, 'KNOB-REACH.md');
check(existsSync(reachPath), 'KNOB-REACH.md is present');
if (existsSync(reachPath)) {
  const reach = readFileSync(reachPath, 'utf8');
  const slots = readColorSlots(join(root, 'client.js'));
  const missing = slots.filter((slot) => !reach.includes('`' + slot.token + '`') && !reach.includes(slot.token));
  check(
    missing.length === 0,
    'every knob appears in KNOB-REACH.md (' +
      slots.length +
      ' checked' +
      (missing.length > 0 ? ', missing ' + missing.map((slot) => slot.label).join(', ') : '') +
      ')',
  );
  // The hand-written hint has to be in there too: that column is what the panel
  // shows, and it is the one part of the table a scan cannot regenerate.
  const noHint = slots.filter((slot) => slot.where === '' || !reach.includes(slot.where));
  check(
    noHint.length === 0,
    'every knob carries its where-to-look hint into the table (' +
      slots.length +
      ' checked' +
      (noHint.length > 0 ? ', missing ' + noHint.map((slot) => slot.label).join(', ') : '') +
      ')',
  );
}

// ------------------------------------------------------------ colour anchoring
//
// Every colour the plugin writes has to follow the knobs. A literal in the brand
// layer that no preset rewrites is frozen: it stays brand-blue under a warm scheme.
// This caught eight of them (the info button and its hover, the dimmed ink, the
// caption tone) after the same mistake had already been made twice with the app's
// own aliases, so it is checked rather than remembered.
const audited = frozenBlues(join(root, 'client.js'));
check(
  audited.frozen.length === 0,
  'no colour is frozen outside the knobs (' +
    audited.knobbed +
    ' knobbed, ' +
    audited.derived +
    ' derived' +
    (audited.frozen.length > 0
      ? ', frozen: ' + audited.frozen.map((row) => row.token).join(', ')
      : '') +
    ')',
);

// ---------------------------------------------------------------- package.json
const raw = readFileSync(join(root, 'package.json'));
check(
  !(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf),
  'package.json has no UTF-8 BOM',
);
let manifest = null;
try {
  manifest = JSON.parse(raw.toString('utf8'));
} catch (error) {
  check(false, 'package.json parses: ' + error.message);
}
if (manifest) {
  check(manifest.name === 'dsh-diy-skin', 'package name is ' + manifest.name);
  check(manifest.dsh?.client?.platform === 'web', 'declares a web client half');
  check(!!manifest.dsh?.bundle?.patch, 'declares a bundle patch');
  for (const injected of ['@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-client-locale']) {
    check(
      (manifest.dsh?.client?.inject ?? []).includes(injected),
      'waits for ' + injected,
    );
  }
}

console.log(failed === 0 ? '\nall guards passed' : '\n' + failed + ' guard(s) failed');
process.exit(failed === 0 ? 0 : 1);
