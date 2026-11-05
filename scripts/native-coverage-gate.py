#!/usr/bin/env python3
"""Merge per-OS lcov files and gate @gpuiv/native's unit coverage.

Each CI system (Linux, macOS, Windows) produces one lcov from
`cargo llvm-cov --lib` over its own compile surface — platform `cfg` code
only exists in the binary of the system it targets. Merging sums line hit
counts across systems, so a line covered anywhere counts as covered; the
per-system totals are printed before the merged table (分系统汇总).

The gate: every module NOT on the exempt list must reach 90% merged line
coverage. The exempt modules are exercised by code that cannot run under
`cargo test --lib` — GPU frame paint/build paths (covered by the GPU test
renderer suites in packages/vue and examples) or napi callbacks that need a
live JS environment. Two of them are pure enough to lift later and are
marked "lift pending".

Usage: native-coverage-gate.py <lcov-file> [<lcov-file> ...] [--bar 90]
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC_PREFIX = "packages/native/src/"

# Modules the unit gate does not measure, and why. Keys are paths relative to
# packages/native/src/. Files with no executable lines never appear in lcov
# and need no entry.
EXEMPT: dict[str, str] = {
    "renderer.rs": "GPUI frame build/window/paint code; covered by the GPU test renderer suites",
    "text/paint.rs": "paint-phase per-window state; runs inside GPU frames",
    "markdown/render.rs": "gpui element painting; covered by GPU suites",
    "automation.rs": "painted-bounds machinery; runs inside GPU frames",
    "accessibility.rs": "ARIA token map; covered by getA11yTree GPU dumps (lift pending)",
    "app_menu.rs": "macOS menu construction over a live App/window",
    "canvas.rs": "canvas element build/paint inside GPU frames",
    "canvas2d/context.rs": "the 2D napi context, driven from JS paint calls",
    "canvas2d/geom/path.rs": "flattening arms reached through context suites (lift pending)",
    "custom_elements/mod.rs": "registry sync is unit-tested; custom_surface/wire build gpui elements",
    "custom_elements/anchored.rs": "renders inside GPU frames",
    "custom_elements/code.rs": "renders inside GPU frames",
    "custom_elements/diff.rs": "renders inside GPU frames",
    "custom_elements/img.rs": "renders inside GPU frames",
    "custom_elements/input.rs": "editor element over live gpui entities",
    "custom_elements/markdown.rs": "renders inside GPU frames",
    "lib.rs": "module init glue",
    "tray.rs": "napi surface over platform tray APIs",
    "url_scheme.rs": "registration needs a live GPUI app",
    "open_urls.rs": "callback arms need a ThreadsafeFunction (live JS env)",
    "test_renderer.rs": "test harness itself",
}


def parse_lcov(path: str) -> dict[str, dict[int, int]]:
    files: dict[str, dict[int, int]] = {}
    current: str | None = None
    for raw in open(path, encoding="utf-8", errors="replace"):
        line = raw.strip()
        if line.startswith("SF:"):
            current = line[3:]
            files.setdefault(current, {})
        elif line.startswith("DA:") and current is not None:
            number, count = line[3:].split(",")[:2]
            files[current][int(number)] = files[current].get(int(number), 0) + int(count)
        elif line == "end_of_record":
            current = None
    return files


def totals(files: dict[str, dict[int, int]]) -> tuple[int, int]:
    covered = total = 0
    for lines in files.values():
        total += len(lines)
        covered += sum(1 for count in lines.values() if count > 0)
    return covered, total


def main() -> int:
    args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
    bar = 90
    for index, arg in enumerate(sys.argv[1:]):
        if arg == "--bar":
            bar = int(sys.argv[1:][index + 1])
    if not args:
        print(__doc__)
        return 2

    merged: dict[str, dict[int, int]] = {}
    for path in args:
        files = parse_lcov(path)
        covered, total = totals(files)
        system = Path(path).stem
        percent = 100 * covered / total if total else 0.0
        print(f"{system}: {covered}/{total} lines ({percent:.1f}%)")
        for name, lines in files.items():
            target = merged.setdefault(name, {})
            for number, count in lines.items():
                target[number] = target.get(number, 0) + count

    print()
    failures: list[str] = []
    rows: list[tuple[str, float, str]] = []
    for name in sorted(merged):
        rel = name.split(SRC_PREFIX, 1)[-1] if SRC_PREFIX in name else name
        if "/src/" not in name and not name.startswith(SRC_PREFIX):
            continue  # dependency or test-harness file, not ours
        lines = merged[name]
        covered = sum(1 for count in lines.values() if count > 0)
        total = len(lines)
        percent = 100 * covered / total if total else 100.0
        if rel in EXEMPT:
            rows.append((rel, percent, "exempt — " + EXEMPT[rel]))
        elif percent < bar:
            rows.append((rel, percent, f"FAIL (bar {bar}%)"))
            failures.append(rel)
        else:
            rows.append((rel, percent, "ok"))

    for rel, percent, note in rows:
        print(f"  {percent:6.1f}%  {rel:<34} {note}")

    covered, total = totals(merged)
    print(f"\nmerged: {covered}/{total} lines ({100 * covered / total:.1f}%)")
    if failures:
        print(f"\ncoverage gate: {len(failures)} module(s) under {bar}%: {', '.join(failures)}")
        return 1
    print(f"coverage gate: every non-exempt module is at or above {bar}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
