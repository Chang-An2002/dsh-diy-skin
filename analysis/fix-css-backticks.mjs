/**
 * Strip stray backticks from inside `STYLE_TEXT`.
 *
 * `STYLE_TEXT` is a template literal, so a single backtick inside it — including
 * inside a CSS *comment*, which is where this keeps happening — ends the string
 * early and the bundle stops parsing, usually a long way from the edit that
 * caused it. Quoting a CSS word inside a comment is the natural thing to type, so
 * this is a recurring mistake rather than a one-off: the guard in
 * `plugin-guards.mjs` reports it, and this repairs it.
 *
 * The terminator is found the same way the guard finds it (a backtick followed by
 * a semicolon and a newline), so the two agree on where the CSS ends.
 *
 * Usage: node analysis/fix-css-backticks.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', 'dsh-diy-skin', 'client.js');
const BACKTICK = String.fromCharCode(96);

const source = readFileSync(CLIENT, 'utf8');
const opener = 'const STYLE_TEXT = ' + BACKTICK;
const start = source.indexOf(opener);
if (start < 0) {
  console.error('client.js no longer declares STYLE_TEXT as a template literal');
  process.exit(2);
}
const afterOpener = source.slice(start + opener.length);
const end = afterOpener.search(new RegExp(BACKTICK + ';\\r?\\n'));
if (end < 0) {
  console.error('could not find the end of STYLE_TEXT');
  process.exit(2);
}
const css = afterOpener.slice(0, end);
const strays = css.split(BACKTICK).length - 1;

if (process.argv.includes('--check')) {
  console.log(strays === 0 ? 'no stray backticks in STYLE_TEXT' : strays + ' stray backtick(s)');
  process.exit(strays === 0 ? 0 : 1);
}

if (strays === 0) {
  console.log('no stray backticks in STYLE_TEXT; nothing to do');
  process.exit(0);
}
writeFileSync(
  CLIENT,
  source.slice(0, start + opener.length) + css.split(BACKTICK).join('') + afterOpener.slice(end),
);
console.log('removed ' + strays + ' stray backtick(s) from STYLE_TEXT');
