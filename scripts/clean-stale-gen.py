#!/usr/bin/env python
"""Reap stale build artifacts under ``datasette_sheets/static/gen/``.

Vite is configured with ``emptyOutDir: false`` so the manifest survives
rebuilds (Datasette's ``__init__.py`` reads it to discover the current
entry-point hashes). That setting means every rebuild adds new hashed
bundles without clearing the old ones. After a month of iteration the
``gen/`` directory grows to hundreds of unused files / multiple MB of
stale WASM.

This script reads ``manifest.json`` to find the files the current build
actually references (JS, CSS, WASM), then removes everything else under
``gen/``.

Run:

    just clean-gen
"""

from __future__ import annotations

import json
import pathlib
import sys


def collect_kept_files(obj: object, acc: set[str]) -> None:
    """Walk the manifest tree collecting every ``file`` string."""
    if isinstance(obj, dict):
        file_val = obj.get("file")
        if isinstance(file_val, str):
            acc.add(file_val)
        for v in obj.values():
            collect_kept_files(v, acc)
        for css in obj.get("css", []) if isinstance(obj.get("css"), list) else []:
            if isinstance(css, str):
                acc.add(css)
        for asset in (
            obj.get("assets", []) if isinstance(obj.get("assets"), list) else []
        ):
            if isinstance(asset, str):
                acc.add(asset)
    elif isinstance(obj, list):
        for v in obj:
            collect_kept_files(v, acc)


def main() -> int:
    root = pathlib.Path("datasette_sheets/static")
    manifest_path = root / "manifest.json"
    gen_dir = root / "gen"

    if not manifest_path.exists():
        print(f"no manifest at {manifest_path}; run `just frontend` first")
        return 1
    if not gen_dir.is_dir():
        print(f"no gen dir at {gen_dir}")
        return 0

    manifest = json.loads(manifest_path.read_text())
    keep: set[str] = set()
    collect_kept_files(manifest, keep)

    reaped = 0
    total_bytes = 0
    for path in sorted(gen_dir.iterdir()):
        if not path.is_file():
            continue
        rel = f"gen/{path.name}"
        if rel in keep:
            continue
        size = path.stat().st_size
        path.unlink()
        reaped += 1
        total_bytes += size
        print(f"  rm {rel}  ({size // 1024} KB)")

    kept = sum(1 for p in gen_dir.iterdir() if p.is_file())
    mb = total_bytes / (1024 * 1024)
    print(f"\nreaped {reaped} files ({mb:.1f} MB) — kept {kept} in gen/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
