/**
 * Reading the shipped app's stylesheets, for the analysis scripts.
 *
 * Every tool in this directory needs the same three things: the asar's file
 * table, the CSS chunks the client bundles carry inline, and a way to walk
 * `selector{declarations}` pairs. Keeping one copy means a fix to the archive
 * offset or the unescaping rule lands in one place instead of three.
 *
 * There is no asar library on the machine and none is downloadable, so the
 * format is read by hand: a 16-byte pickle header, then a JSON string of the
 * same length at offset 12, then the concatenated file bodies at
 * `12 + headerLength`.
 */
import { openSync, readFileSync, readSync } from 'node:fs';

export const DEFAULT_ASAR =
  process.env.DSH_ASAR ??
  'C:\\Users\\pipi0\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar';

/**
 * Open the archive.
 * @returns `{ entries, readEntry }` — `entries` is `[internalPath, entry]`, and
 *   `readEntry(entry)` returns that file's bytes.
 */
export function openAsar(path = DEFAULT_ASAR) {
  const fd = openSync(path, 'r');
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  const stringLength = head.readUInt32LE(4);
  const raw = Buffer.alloc(stringLength);
  readSync(fd, raw, 0, stringLength, 12);
  let text = raw.subarray(4).toString('utf8');
  text = text.slice(0, text.lastIndexOf('}') + 1);
  const header = JSON.parse(text);
  const base = 12 + stringLength;

  const entries = [];
  (function walk(node, prefix) {
    if (!node.files) return;
    for (const [name, entry] of Object.entries(node.files)) {
      const internal = prefix ? prefix + '/' + name : name;
      if (entry.files) walk(entry, internal);
      else entries.push([internal, entry]);
    }
  })(header, '');

  return {
    entries,
    readEntry(entry) {
      const buffer = Buffer.alloc(entry.size);
      readSync(fd, buffer, 0, entry.size, base + Number(entry.offset));
      return buffer;
    },
  };
}

/** `.../node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js` -> package name. */
export function packageOf(internalPath) {
  const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(internalPath);
  return match ? match[1] : internalPath.split('/').slice(0, 2).join('/');
}

/**
 * Every stylesheet the client ships, whether it is inlined into a bundle as a
 * long string literal or sits in the archive as its own `.css` file.
 *
 * Both forms matter and missing either one gives a wrong answer to "who uses
 * this token": the theme package inlines its palette, while `MenuSurface` ships
 * a real `.module.css` — the popup material is only attributable to a selector
 * once the `.css` files are read as well.
 */
export function collectCss(entries, readEntry) {
  const chunks = [];
  for (const [path, entry] of entries) {
    if (entry.unpacked === true) continue;
    const pkg = packageOf(path);
    if (/\.css$/.test(path)) {
      const css = readEntry(entry).toString('utf8');
      if (css.includes('--dsw-') || css.includes('--dsd-')) chunks.push({ path, package: pkg, css });
      continue;
    }
    if (!/\.(js|mjs|cjs)$/.test(path)) continue;
    if (!/dsh-client-ui-|dsh-client-modules|dsh-web-/.test(path)) continue;
    const text = readEntry(entry).toString('utf8');
    for (const match of text.matchAll(/=\s*"((?:[^"\\]|\\.){80,})"/g)) {
      const css = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
      if (css.includes('--dsw-') || css.includes('--dsd-')) chunks.push({ path, package: pkg, css });
    }
  }
  return chunks;
}

/**
 * `selector{declarations}` — these bundles contain no nested rules.
 *
 * Comments are removed first. Without that, a comment sitting between two rules
 * is captured as part of the next selector, and the consumer scan then reports
 * that a token is used by "/* Filtering only the background keeps ...".
 */
export function forEachRule(css, visit) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while ((match = re.exec(clean))) visit(match[1].trim(), match[2]);
}

/** The `--custom: value` declarations of one rule body. */
export function declarationsOf(body) {
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

/**
 * A component stylesheet's class names are hashed by the bundler, in two shapes:
 * `fO69Vq_sessionItem` and `_dialog_o6lrb_33`. The hash says nothing to a reader,
 * so it is stripped and what is left is the name the author wrote — which is the
 * useful half when the question is "which part of the UI does this token paint?".
 *
 * Telling a hash from a name is guesswork, so the test is deliberately narrow: a
 * bundle hash in this codebase carries a digit (or, failing that, is the only
 * mixed-case token in the pair). A name that survives the guess unchanged is a
 * cosmetic loss in a tooltip, not a wrong answer.
 */
export function readableSelector(selector) {
  const hashish = (text) => /\d/.test(text) || (/[a-z]/.test(text) && /[A-Z]/.test(text));
  return selector
    .replace(/\[data-ds-dark-theme\]/g, '')
    // `._name_hash[_index]`: the name comes first, so it is the one to keep.
    .replace(/\._?([A-Za-z][A-Za-z0-9-]*)_([A-Za-z0-9]{4,9})(?:_\d+)?/g, (whole, name, hash) =>
      /\d/.test(hash) ? '.' + name : whole,
    )
    // `.hash_name` or `._hash_name`: the name comes second.
    .replace(/\._?([A-Za-z0-9-]{5,9})_([A-Za-z][A-Za-z0-9-]*)/g, (whole, hash, name) =>
      hashish(hash) ? '.' + name : whole,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read one `const NAME = [ ... ];` / `{ ... }` literal's body out of a source file. */
export function literalBody(source, name) {
  const head = new RegExp('const ' + name + ' = ([\\[{])');
  const match = head.exec(source);
  if (!match) throw new Error('the source no longer declares ' + name);
  const closer = match[1] === '[' ? ']' : '}';
  const end = source.indexOf('\n    ' + closer + ';', match.index);
  if (end < 0) throw new Error('could not find the end of ' + name);
  return source.slice(match.index, end);
}

/**
 * The plugin's `COLOR_SLOTS` table, as objects.
 *
 * `where` is the hand-written "look here" hint, and the optional trailing group
 * keeps this parser working for a slot that has not got one yet — a knob without
 * a hint is caught by the test suite, not by a parse failure here.
 */
export function readColorSlots(clientPath) {
  const source = readFileSync(clientPath, 'utf8');
  const slots = [];
  for (const line of literalBody(source, 'COLOR_SLOTS').split('\n')) {
    const match =
      /key:\s*'([^']+)'.*?group:\s*'([^']+)'.*?label:\s*'([^']+)'.*?token:\s*'(--[a-z0-9-]+)'.*?light:\s*'(#[0-9a-fA-F]+)'.*?dark:\s*'(#[0-9a-fA-F]+)'(?:.*?where:\s*'([^']*)')?/.exec(
        line,
      );
    if (match) {
      slots.push({
        key: match[1],
        group: match[2],
        label: match[3],
        token: match[4],
        light: match[5],
        dark: match[6],
        where: match[7] ?? '',
      });
    }
  }
  if (slots.length === 0) throw new Error('COLOR_SLOTS could not be parsed');
  return slots;
}
