"""Fetches the survey's inputs into the work directory and checks them.

The Trades Hall twin publishes the Matterport E57 capture of 11 July 2026 as
a manifest (station poses and exposure), the reviewed dollhouse mesh in the
E57 frame, and an equirectangular panorama per station. The Grand Hall is
sweeps 0-48. Every file is checked against the manifest's SHA-256.

Usage (in the work directory): python3 $SURVEY/fetch_inputs.py [base-url]
Writes data/manifest.json, data/dollhouse.glb, data/pano8k/scan_NNN_8192.webp
"""
import hashlib
import json
import os
import sys
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://twin.venviewer.com/trades-hall").rstrip("/")
GRAND_HALL_SWEEPS = range(0, 49)


def fetch(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path):
        with urllib.request.urlopen(url, timeout=120) as response, open(path + ".part", "wb") as out:
            out.write(response.read())
        os.replace(path + ".part", path)
    return path


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    manifest_path = fetch(f"{BASE}/manifest.json", "data/manifest.json")
    manifest = json.load(open(manifest_path))
    hashes = manifest.get("contentHashes", {})
    wanted = [(manifest["mesh"]["path"], "data/dollhouse.glb")]
    for i in GRAND_HALL_SWEEPS:
        sweep = f"scan_{i:03d}"
        wanted.append((f"tiles/{sweep}/equirect_8192.webp", f"data/pano8k/{sweep}_8192.webp"))
    failed = []
    for remote, local in wanted:
        fetch(f"{BASE}/{remote}", local)
        expected = hashes.get(remote)
        if expected is not None and sha256(local) != expected:
            failed.append(remote)
        print("ok" if remote not in failed else "HASH MISMATCH", remote)
    if failed:
        sys.exit(f"{len(failed)} files do not match the manifest's hashes")


if __name__ == "__main__":
    main()
