"""Fetches a room's inputs into the work directory and checks them: fetch_inputs.py driven by a
room config. Uses fetch_inputs.py's own fetch(), sha256() and user agent.

Writes data/manifest.json, data/dollhouse.glb and data/pano8k/<station>_8192.webp (the name
project.load_pano reads), each checked against the manifest's SHA-256; also checks that the
config's mesh path and meshSha256 are the manifest's and the file's, and that every station the
config lists is in the manifest. Files already present are kept (and still checked).
"""
import json
import sys

from . import legacy


def run(room, base=None):
    fi = legacy.fetch_inputs()
    src = room.cfg['source']
    base = (base or src['twin']).rstrip('/')
    manifest_path = fi.fetch(f"{base}/manifest.json", "data/manifest.json")
    with open(manifest_path, encoding='utf-8') as f:
        manifest = json.load(f)
    hashes = manifest.get("contentHashes", {})
    problems = []
    if manifest["mesh"]["path"] != src['mesh']:
        problems.append(f"source.mesh {src['mesh']} is not the manifest's mesh {manifest['mesh']['path']}")
    if src.get('meshSha256') and hashes.get(src['mesh']) != src['meshSha256']:
        problems.append(f"source.meshSha256 {src['meshSha256'][:12]} is not the manifest's {str(hashes.get(src['mesh']))[:12]}")
    nodes = {n['id'] for n in manifest['nodes']}
    missing = [s for s in room.station_ids() if s not in nodes]
    if missing:
        problems.append(f"stations not in the manifest: {missing}")
    if problems:
        sys.exit('\n'.join(problems))
    wanted = [(manifest["mesh"]["path"], "data/dollhouse.glb")]
    for sid in room.station_ids():
        i = int(sid[5:])
        wanted.append((src['panoramas']['path'].format(index=i), f"data/pano8k/{sid}_8192.webp"))
    failed = []
    for remote, local in wanted:
        fi.fetch(f"{base}/{remote}", local)
        expected = hashes.get(remote)
        # A file the manifest does not vouch for is not an input.
        status = "NO HASH IN MANIFEST" if expected is None else "ok" if fi.sha256(local) == expected else "HASH MISMATCH"
        if status != "ok":
            failed.append(remote)
        print(status, remote)
    if src.get('meshSha256') and fi.sha256("data/dollhouse.glb") != src['meshSha256']:
        failed.append("data/dollhouse.glb is not source.meshSha256")
    if failed:
        sys.exit(f"{len(failed)} files are not the manifest's")
