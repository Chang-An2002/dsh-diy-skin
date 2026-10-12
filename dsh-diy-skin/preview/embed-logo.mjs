/**
 * Embed the official DeepSeek mark into the plugin bundle.
 *
 * The chip needs the logo, and a plugin bundle cannot read files out of a
 * package directory at runtime (the webserver serves bundles, not assets), so
 * the path data has to travel inside `client.js` — the same reason the three
 * mascot pictures are inlined.
 *
 * It is read from the *installed* `@deepseek-ai/dsh-client-ui-primitives`
 * rather than from a checked-in copy, so the geometry cannot drift from the one
 * the rest of the UI draws (`FISH_LOGO_PATH` / `FISH_LOGO_VIEWBOX` are exported
 * by that package precisely so consumers can compose their own svg around the
 * same silhouette).
 *
 * Usage:
 *   node preview/embed-logo.mjs [path/to/app.asar]
 *
 * Rewrites only the block between the `@dsd-logo` markers in client.js.
 */
import { readFileSync, writeFileSync, openSync, readSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(HERE, '..', 'client.js');
const DEFAULT_ASAR =
  'C:\\Users\\pipi0\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';
const PRIMITIVES = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js';

const asarPath = process.argv[2] ?? DEFAULT_ASAR;
if (!existsSync(asarPath)) throw new Error(`asar not found: ${asarPath}`);

/** Read one file out of an asar archive by internal path. */
function readFromAsar(archive, internalPath) {
  const fd = openSync(archive, 'r');
  const pre = Buffer.alloc(16);
  readSync(fd, pre, 0, 16, 0);
  const stringLen = pre.readUInt32LE(4);
  const raw = Buffer.alloc(stringLen);
  readSync(fd, raw, 0, stringLen, 12);
  let text = raw.subarray(4).toString('utf8');
  text = text.slice(0, text.lastIndexOf('}') + 1);
  const header = JSON.parse(text);
  const base = 12 + stringLen;
  let node = header;
  for (const part of internalPath.split('/').filter(Boolean)) {
    node = node.files?.[part];
    if (!node) throw new Error(`not in archive: ${internalPath} (at ${part})`);
  }
  if (node.unpacked === true) throw new Error(`entry is unpacked, not inline: ${internalPath}`);
  const buf = Buffer.alloc(node.size);
  readSync(fd, buf, 0, node.size, base + Number(node.offset));
  return buf.toString('utf8');
}

const source = readFromAsar(asarPath, PRIMITIVES);

const pathMatch = /const FISH_LOGO_PATH = "([^"]+)"/.exec(source);
const boxMatch = /const FISH_LOGO_VIEWBOX = \{\s*width:\s*([\d.]+),\s*height:\s*([\d.]+)\s*\}/.exec(source);
if (!pathMatch) throw new Error('FISH_LOGO_PATH not found in the installed primitives');
if (!boxMatch) throw new Error('FISH_LOGO_VIEWBOX not found in the installed primitives');

const path = pathMatch[1];
const viewBox = `0 0 ${boxMatch[1]} ${boxMatch[2]}`;

const client = readFileSync(CLIENT, 'utf8');
const START = '    // @dsd-logo:start';
const END = '    // @dsd-logo:end';
const start = client.indexOf(START);
const end = client.indexOf(END);
if (start < 0 || end < 0 || end < start) throw new Error('the @dsd-logo markers are missing from client.js');

const block = [
  START + ' — extracted from the installed @deepseek-ai/dsh-client-ui-primitives, do not edit by hand',
  '    /** The DeepSeek mark: the fish silhouette the rest of the UI draws. */',
  "    const LOGO_VIEWBOX = '" + viewBox + "';",
  "    const LOGO_PATH =",
  "      '" + path + "';",
  END,
].join('\n');

writeFileSync(CLIENT, client.slice(0, start) + block + client.slice(end + END.length), 'utf8');
console.log(`embedded ${path.length} bytes of path data, viewBox ${viewBox}`);
