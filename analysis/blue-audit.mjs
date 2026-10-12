/**
 * Blue ghosts, properly.
 *
 * A token is only "covered" if its colour follows the palette the user chose.
 * Being listed in `BRAND_TOKENS` is *not* enough: a preset does not rewrite that
 * layer, so any literal blue in it is frozen, and a warm scheme leaves it blue.
 * That is exactly how this was missed twice — first with the app's own aliases
 * (the code chips, the file cards, the floating buttons) and then again one level
 * down, with eight of this plugin's own brand values (the info button and its
 * hover, the dimmed ink, the caption tone).
 *
 * Covered means one of two things:
 *
 *   - knobbed — the token is in `COLOR_SLOTS`, so a knob and every preset set it;
 *   - derived — the token is in `DERIVED_TOKENS`, which is written in terms of the
 *     knobbed tokens only.
 *
 * Anything else that resolves to a blue-ish colour is reported. Run it after
 * adding a token to either layer. `--check` semantics: exits non-zero when
 * something is frozen, so it is usable as a gate.
 *
 * Usage: node analysis/blue-audit.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', 'dsh-diy-skin', 'client.js');

/** One of the plugin's tables, as source text. Arrays and objects both. */
function table(source, name) {
  const array = source.indexOf('const ' + name + ' = [');
  const object = source.indexOf('const ' + name + ' = {');
  const start = array >= 0 ? array : object;
  if (start < 0) throw new Error('no table named ' + name);
  const end = source.indexOf(array >= 0 ? '\n    ];' : '\n    };', start);
  return source.slice(start, end);
}

/** Hue in degrees and rough saturation, enough to say "this is a blue". */
function hueOf(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  if (span === 0) return { hue: 0, saturation: 0 };
  const hue =
    max === r
      ? 60 * (((g - b) / span) % 6)
      : max === g
        ? 60 * ((b - r) / span + 2)
        : 60 * ((r - g) / span + 4);
  return { hue: (hue + 360) % 360, saturation: span / (1 - Math.abs(max + min - 1) || 1) };
}

/**
 * Blue enough to be noticed. The saturation floor matters: a neutral grey with a
 * faint blue cast (`#ebeef2`, `#272730`) is how this app spells "no colour", and
 * tinting those would be wrong.
 */
function blueish(hex) {
  const { hue, saturation } = hueOf(hex);
  return hue > 195 && hue < 268 && saturation > 0.1;
}

/**
 * The audit, as a function: every colour in the plugin that would stay blue under
 * a warm scheme, with a note of where it lives.
 *
 * @param clientPath the plugin's browser half.
 */
export function frozenBlues(clientPath = CLIENT) {
  const source = readFileSync(clientPath, 'utf8');
  const knobbed = new Set(
    [...table(source, 'COLOR_SLOTS').matchAll(/token:\s*'(--[a-z0-9-]+)'/g)].map((m) => m[1]),
  );
  const derived = new Set(
    [...table(source, 'DERIVED_TOKENS').matchAll(/'(--[a-z0-9-]+)':/g)].map((m) => m[1]),
  );
  const frozen = [];
  for (const match of table(source, 'BRAND_TOKENS').matchAll(
    /'(--dsw-[a-z0-9-]+)':\s*\{\s*light:\s*'(#[0-9a-fA-F]{3,8})',\s*dark:\s*'(#[0-9a-fA-F]{3,8})'\s*\}/g,
  )) {
    const [token, light, dark] = [match[1], match[2], match[3]];
    if (knobbed.has(token) || derived.has(token)) continue;
    if (blueish(light) || blueish(dark)) frozen.push({ token, light, dark });
  }
  return { knobbed: knobbed.size, derived: derived.size, frozen };
}

// The CLI half: report, and exit non-zero when something is frozen.
if (process.argv[1] && process.argv[1].endsWith('blue-audit.mjs')) {
  const { knobbed, derived, frozen } = frozenBlues();
  console.log('knobbed ' + knobbed + '   derived ' + derived);
  if (frozen.length === 0) {
    console.log('no frozen blues: every colour in the plugin follows the anchors');
    process.exit(0);
  }
  console.log(frozen.length + ' frozen blue(s) — a warm scheme will leave these blue:');
  for (const row of frozen) {
    console.log('  ' + row.token.padEnd(50) + row.light + ' / ' + row.dark);
  }
  console.log('Fix: add it to DERIVED_TOKENS as a mix of the accent, the canvas or the ink.');
  process.exit(1);
}
