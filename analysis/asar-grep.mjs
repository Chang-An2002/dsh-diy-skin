// Grep files inside an asar archive without extracting it.
// Usage: node asar-grep.mjs <archive> <regex> [pathSubstring] [maxMatches]
// Prints "internalPath:lineNumber: line" for text files that match.
//
// Built on `analysis/lib/asar-css.mjs`, so the header offset and the
// `unpacked`/`offset` handling have one implementation instead of two. Entries
// marked `unpacked` carry no `offset` and are skipped — their bytes live in
// `<archive>.unpacked` next to the archive.
//
// Quoting note for PowerShell: pass an empty `pathSubstring` as `''` only if the
// shell keeps it. PowerShell drops an empty string argument when calling a native
// command, so `... "" 6` arrives as `... 6` and silently becomes a path filter of
// "6", which looks exactly like "no matches anywhere in the archive".
import { openAsar } from './lib/asar-css.mjs';

const [archive, pattern, pathFilter = '', maxArg] = process.argv.slice(2);
if (!archive || !pattern) {
  console.error('usage: node asar-grep.mjs <archive> <regex> [pathSubstring] [maxMatches]');
  process.exit(2);
}
const max = Number(maxArg || 120);
const re = new RegExp(pattern);

/** Extensions worth reading as text; everything else is binary by definition. */
const TEXT = /\.(js|mjs|cjs|json|css|html|md|yml|yaml|txt|map|d\.ts|ts)$/;

const { entries, readEntry } = openAsar(archive);
let shown = 0;
let scanned = 0;
for (const [internalPath, entry] of entries) {
  if (entry.unpacked === true) continue;
  if (pathFilter && !internalPath.includes(pathFilter)) continue;
  if (!TEXT.test(internalPath)) continue;
  const text = readEntry(entry).toString('utf8');
  scanned += 1;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!re.test(lines[i])) continue;
    console.log(`${internalPath}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
    if (++shown >= max) {
      console.log(`… stopped at ${max} matches`);
      process.exit(0);
    }
  }
}
console.log(`-- ${shown} match(es); scanned ${scanned} text entries --`);
