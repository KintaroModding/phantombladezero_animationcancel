"""Raises the version of the mod by one step: the second number (1.0 -> 1.1, 1.9 -> 1.10).

The version is in mod.json ("version": "<major>.<minor>"). Some mods also write it into their log line, so the script
also changes that line when its file exists: `local VERSION = "<major>.<minor>"` in src/<folder>/Scripts/main.lua (UE4SS
mods), and the first `const <NAME>_VERSION = "<major>.<minor>";` in src/<folder>/main.js (PBZModLoader mods). The rest of
each file keeps its layout.

Usage:
    python scripts/bump_version.py           # 1.0 -> 1.1
    python scripts/bump_version.py --major   # 1.4 -> 2.0, only when the user says so
    python scripts/bump_version.py --show    # print the version
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOD_JSON = ROOT / "mod.json"
VERSION = re.compile(r"^(\d+)\.(\d+)$")
JSON_VERSION = re.compile(r'("version"\s*:\s*")([^"]*)(")')
# (file below src/<folder>, its version line, how the error names the line)
SCRIPTS = [
    (Path("Scripts") / "main.lua", re.compile(r'^(local VERSION = ")([^"]*)(")', re.MULTILINE),
     'local VERSION = "<major>.<minor>"'),
    (Path("main.js"), re.compile(r'^(const [A-Z][A-Z0-9_]*VERSION = ")([^"]*)(";)', re.MULTILINE),
     'const <NAME>_VERSION = "<major>.<minor>";'),
]


def main() -> None:
    text = MOD_JSON.read_text(encoding="utf-8")
    mod = json.loads(text)
    current = mod["version"]
    match = VERSION.match(current)
    if not match:
        sys.exit(f'mod.json: version "{current}" is not <major>.<minor>')
    found = []
    for relative, pattern, shown in SCRIPTS:
        path = ROOT / "src" / mod["folder"] / relative
        if not path.is_file():
            continue
        script = path.read_text(encoding="utf-8")
        script_match = pattern.search(script)
        if script_match is None:
            sys.exit(f"{path}: no line '{shown}'")
        if script_match.group(2) != current:
            sys.exit(f"Versions differ: mod.json {current}, {relative.name} {script_match.group(2)}. Make them equal first.")
        found.append((path, pattern, script))

    if "--show" in sys.argv:
        print(current)
        return

    major, minor = int(match.group(1)), int(match.group(2))
    new = f"{major + 1}.0" if "--major" in sys.argv else f"{major}.{minor + 1}"
    MOD_JSON.write_text(JSON_VERSION.sub(lambda m: m.group(1) + new + m.group(3), text, count=1),
                        encoding="utf-8", newline="\n")
    for path, pattern, script in found:
        path.write_text(pattern.sub(lambda m: m.group(1) + new + m.group(3), script, count=1),
                        encoding="utf-8", newline="\n")
    print(f"Version {current} -> {new}")


if __name__ == "__main__":
    main()
