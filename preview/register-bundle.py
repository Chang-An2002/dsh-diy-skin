"""Register the plugin as a real profile bundle, the way `install_bundle` would.

Three writes, all reversible:
  1. the profile's package.json gains a `link:` dependency on the workspace package
  2. that package name joins `dsh.profile.bundles`, so its patch layer composes
  3. the manual `insert` block leaves cordis.patch.yml, because the bundle's own
     patch (package.json dsh.bundle.patch) now supplies the row

A `link:` dependency resolves to a junction, so the workspace stays the single
source of truth and later edits need no reinstall.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

PROFILE = Path(r"C:\Users\pipi0\.dsh\profiles\desktop")
WORKSPACE = Path(r"C:\Users\pipi0\Documents\deepseek-harness\default-workspace")
PACKAGE_NAME = "dsh-deepseek-decor"
DEP_KEY = "@local/" + PACKAGE_NAME
DEP_SPEC = "link:" + (WORKSPACE / PACKAGE_NAME).as_posix()

NODE = Path(r"C:\Users\pipi0\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe")
PNPM = Path(r"C:\Users\pipi0\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs")

MANIFEST = PROFILE / "package.json"
PATCH = PROFILE / "cordis.patch.yml"

INSERT_MARKER = "# DeepSeek brand decoration bundle"
INSERT_ROW = "      name: \"C:/Users/pipi0/Documents/deepseek-harness/default-workspace/dsh-deepseek-decor/index.js\""


def main() -> int:
    dry = "--apply" not in sys.argv

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    bundles = manifest.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
    deps = manifest.setdefault("dependencies", {})

    print("profile      :", PROFILE)
    print("dependency   :", DEP_KEY, "=", DEP_SPEC)
    print("bundles before:", bundles)
    print("bundles after :", bundles + ([DEP_KEY] if DEP_KEY not in bundles else []))
    print("has dep      :", deps.get(DEP_KEY))

    # --- 1 + 2: manifest -----------------------------------------------------
    deps[DEP_KEY] = DEP_SPEC
    if DEP_KEY not in bundles:
        bundles.append(DEP_KEY)

    # --- 3: drop the manual insert from the profile patch --------------------
    text = PATCH.read_text(encoding="utf-8")
    kept, skipped = [], False
    for line in text.splitlines():
        if line.startswith(INSERT_MARKER):
            skipped = True
            continue
        if skipped:
            # Skip the comment block and the insert row belonging to the plugin.
            if line.startswith("#") or line.startswith("- insert:") or line.startswith("    - id: deepseek-decor") or line.startswith("      name: \"C:/Users/pipi0/Documents/deepseek-harness/default-workspace/dsh-deepseek-decor"):
                continue
            skipped = False
        kept.append(line)
    new_patch = "\n".join(kept).rstrip() + "\n"
    removed = INSERT_ROW not in new_patch

    print("\npatch keeps the manual insert:", not removed)

    if dry:
        print("\n--- package.json that would be written ---")
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
        print("\n--- cordis.patch.yml that would be written ---")
        print(new_patch)
        print("(dry run: pass --apply to write)")
        return 0

    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    PATCH.write_text(new_patch, encoding="utf-8")
    print("\nwrote package.json and cordis.patch.yml")

    result = subprocess.run(
        [str(NODE), str(PNPM), "install", "--reporter=append-only"],
        cwd=PROFILE,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print("pnpm install exit:", result.returncode)
    print(((result.stdout or "")[-1500:]))

    link = PROFILE / "node_modules" / "@local" / PACKAGE_NAME
    print("installed at :", link)
    print("exists       :", link.exists())
    if link.exists():
        sentinel = WORKSPACE / PACKAGE_NAME / ".bundle-sentinel"
        try:
            sentinel.write_text("live", encoding="utf-8")
            print("workspace edits reach it:", (link / ".bundle-sentinel").exists())
        finally:
            sentinel.unlink(missing_ok=True)
        patch = link / "cordis.patch.yml"
        print("bundle patch reachable :", patch.exists())
    return 0 if result.returncode == 0 and link.exists() else 1


if __name__ == "__main__":
    raise SystemExit(main())
