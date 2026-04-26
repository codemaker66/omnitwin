"""Build manifest.json for a Venue Artifact bundle.

Walks the bundle root, computes SHA-256 + size of every regular file,
and writes manifest.json with the v1 contract from D-014:

  schema_version  : "venviewer.assetbundle.v0"
  venue_id        : --venue-id
  run_id          : --run-id
  signature       : placeholder per D-014 — { status: "placeholder",
                    algorithm: null, key_id: null, value: null }
  files           : alphabetically sorted [{name, size, sha256}]
  total_size      : aggregate size of all listed files

The signature placeholder is intentionally non-empty: the schema must
not change between v1 and v2. Backend ingestion (T-053) re-verifies
SHA-256 against the manifest's claims, then upgrades the signature
fields to a real Ed25519 (or Sigstore at v2) value.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

SCHEMA_VERSION = "venviewer.assetbundle.v0"

# Don't include the manifest or the trainer's working subdirs in the manifest
# itself. Subdirs like ckpts/ and ply/ exist for trainer reproducibility but
# are not part of the bundle contract — the canonical PLY is copied to
# scene.ply at the bundle root.
EXCLUDE_NAMES = {"manifest.json"}


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            buf = f.read(chunk)
            if not buf:
                break
            h.update(buf)
    return h.hexdigest()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--bundle",   required=True, help="bundle directory")
    p.add_argument("--venue-id", required=True)
    p.add_argument("--run-id",   required=True)
    args = p.parse_args()

    bundle = Path(args.bundle)
    if not bundle.is_dir():
        raise SystemExit(f"bundle directory not found: {bundle}")

    files = []
    for entry in sorted(bundle.iterdir()):
        if not entry.is_file():
            continue
        if entry.name in EXCLUDE_NAMES:
            continue
        files.append(
            {
                "name":   entry.name,
                "size":   entry.stat().st_size,
                "sha256": sha256_file(entry),
            }
        )
    files.sort(key=lambda row: row["name"])

    total = sum(f["size"] for f in files)

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "venue_id":       args.venue_id,
        "run_id":         args.run_id,
        "signature": {
            "status":    "placeholder",
            "algorithm": None,
            "key_id":    None,
            "value":     None,
        },
        "files":      files,
        "total_size": total,
    }

    out = bundle / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2))
    print(
        f"manifest.json written → {out} "
        f"({total:,} bytes across {len(files)} files)"
    )


if __name__ == "__main__":
    main()
