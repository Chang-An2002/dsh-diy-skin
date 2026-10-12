"""Sanity-check the preview page: extract its inline script for a syntax check,
and confirm every getElementById target exists in the markup.

Writes the extracted script next to this file (the sandbox's temp directory is
not writable); the caller runs `node --check` on it.
"""

import re
import sys
from pathlib import Path

HTML = Path(__file__).with_name("index.html")
EXTRACTED = Path(__file__).with_name(".preview-script.mjs")


def main() -> int:
    text = HTML.read_text(encoding="utf-8")

    match = re.search(r"<script>(.*?)</script>", text, re.S)
    if not match:
        print("FAIL: no inline script found")
        return 1
    script = match.group(1)
    EXTRACTED.write_text(script, encoding="utf-8")
    print(f"extracted inline script -> {EXTRACTED.name}")

    # Every id the script reaches for must exist in the markup.
    wanted = sorted(set(re.findall(r"getElementById\('([^']+)'\)", script)))
    missing = [name for name in wanted if f'id="{name}"' not in text]
    for name in wanted:
        print(("OK   " if name not in missing else "FAIL ") + "id=" + name)

    # The script must not still reference the removed API-key probe.
    stale = [token for token in ("keyInput", "probeOut", "api.deepseek.com") if token in script]
    for token in stale:
        print(f"FAIL: stale reference to {token}")
    if not stale:
        print("OK   no stale API-key probe references")

    if missing or stale:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
