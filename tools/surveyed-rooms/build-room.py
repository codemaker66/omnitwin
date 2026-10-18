"""Builds a surveyed room's survey files from its config: fetch, depth renders, projection, wall
depth and relief, corner and window fixes, atlas packing, ceiling, floor, publish.

    python -X utf8 tools/surveyed-rooms/build-room.py <room.json> <work-dir> [--publish DIR]
        [--from STEP] [--to STEP] [--inputs-from DIR [--reuse-depth]] [--twin URL] [--plan]
        [--expect-legacy]

Steps (each runs in <work-dir>, one process per old script invocation, as build.sh runs them):
  check     validate the config (check_room.py and the build's own checks); write room.json,
            views/ (roomlib, LF), build/stations.json, build/ledger.json, build/plan.json
  inputs    data/: manifest, dollhouse mesh, the room's 8K panoramas (hash-checked), the mesh dump
  depth     data/depth1024/: each station's distance cubemap
  surfaces  out-walls/: the walls' and ceiling's measured positions
  project   proj/: panoramas onto every wall, the ceiling, each dome and the floor
  windows   proj/<wall>-glass.npy, -layered.npy, build/glass.json (with the glass checked
            against the scan)
  corners   out-walls/*.fixed.f32, proj/wall-*.npz corrected
  atlas     the wall atlas WebPs
  relief    relief/*.f32 and the GHR1 file(s): walls, and the ceiling when ceilingRelief is set
  overhead  the ceiling and dome WebPs
  floor     the flattened floor and its WebPs
  publish   build/survey.json; with --publish, copies survey.outputs (and survey.json for rooms that
            publish it) to DIR, which must be the config's survey.publish.folder

Inputs and depth maps already in the work directory are kept. --inputs-from links (or copies)
another work directory's manifest, mesh, mesh dump and this room's panoramas (the inputs step
then hash-checks the manifest's files against it); its depth maps only with --reuse-depth, so by
default the depth step renders every map and an identity run compares them. Every linked path
is listed in build/linked.json, and prove-build-identity.py reports those as linked, not as
identical. --from/--to run a span of steps (check always runs); a restart --from windows or
corners is refused when a wall uses the clear colour test, because the corners step rewrites
proj/wall-*.npz in place. --plan prints the gates the config opens and the steps, and writes
nothing. --expect-legacy refuses to run unless the ledger is empty (the Grand Hall's identity
run). --publish refuses test-sized depth maps (B21), another checkout's node modules (B22) and
glass the scan disagrees with (build/glass.json).

Method constants stay in code (roombuild/); room facts come from the config.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check_room  # noqa: E402
import roomlib  # noqa: E402
from roombuild import atlas as atlas_step  # noqa: E402
from roombuild import legacy  # noqa: E402
from roombuild import publish as publish_step  # noqa: E402
from roombuild import relief as relief_step  # noqa: E402
from roombuild.context import NODE_ENV, Room  # noqa: E402

STEPS = ["check", "inputs", "depth", "surfaces", "project", "windows", "corners", "atlas", "relief", "overhead", "floor", "publish"]
REPO = os.path.dirname(os.path.dirname(HERE))
STEP_PY = os.path.join(HERE, "roombuild", "step.py")
DEPTH_SIZE = 1024                    # project.py DEPTH_SIZE / DEPTH_DIR
WATCHED = ("data", "out-walls", "proj", "relief", "views")


class Refused(SystemExit):
    pass


def refuse(lines):
    lines = [lines] if isinstance(lines, str) else lines
    raise Refused("build-room: refused\n" + "\n".join(f"  - {line}" for line in lines))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def write_json(path, value):
    write_bytes(path, (json.dumps(value, indent=1) + "\n").encode("utf-8"))


# --- the plan -------------------------------------------------------------------------------------

def commands(room):
    """Every command the build runs, by step (argv lists; py(...) runs roombuild/step.py)."""
    s = room.survey
    py = lambda *a: [sys.executable, "-X", "utf8", STEP_PY, a[0], "room.json", *a[1:]]  # noqa: E731
    out = {
        "inputs": [py("inputs")],
        "depth": [["node", os.path.join(HERE, "render-depth-room.mjs"), "build/stations.json", str(DEPTH_SIZE), "data/depth1024"]],
        "surfaces": [["node", legacy.survey_path("render.mjs"), "views/views-walls.json", "out-walls"],
                     ["node", legacy.survey_path("render.mjs"), "views/views-ceiling.json", "out-walls"]],
        "project": [py("project-wall", w["name"]) for w in room.order] + [py("project-ceiling")]
                   + [py("project-dome", d["id"]) for d in room.cfg["ceiling"].get("domes", [])] + [py("project-floor")],
        "windows": [py("windows")],
        "corners": [py("corners")],
        "atlas": [py("atlas")],
        "relief": [py("wall-depth"), ["node", os.path.join(HERE, "relief-mesh-room.mjs"), "build/relief-walls.json"]],
        "overhead": [py("overhead", "proj")],
        "floor": [py("flatten-floor", "proj/floor.npz", "proj/floor-flat.npz", str(s["floorPhoto"]["ppm"])),
                  py("pack-floor", "proj/floor-flat.npz", "proj")],
    }
    if "ceilingRelief" in s:
        out["relief"] += [py("ceiling-relief"), ["node", os.path.join(HERE, "relief-mesh-room.mjs"), "build/relief-ceiling.json"]]
    return out


def describe_plan(room, problems, ledger):
    lines = [f"{room.cfg['name']} ({room.cfg['slug']}), config sha256 {room.sha256[:16]}, method revision {room.revision}"]
    lines.append(f"  {len(room.station_ids())} stations, {len(room.order)} walls, {len(roomlib.wall_views(room.cfg))} wall tiles")
    if problems:
        lines.append("  REFUSED:")
        lines += [f"    {p}" for p in problems]
        return lines
    lines.append(f"  ledger: {'empty (every step is the Grand Hall code path)' if not ledger else f'{len(ledger)} gates'}")
    for row in ledger:
        lines.append(f"    {row['gate']:<4} {row['where']:<36} {row['what']}{' (' + row['note'] + ')' if row['note'] else ''}")
    lay = atlas_step.layout(room)
    lines.append(f"  atlas {lay['width']} x {lay['height']}, strips {lay['row']} high, {lay['ppm']:.3f} px/m, {lay['packing']}")
    for strip in lay["strips"]:
        lines.append(f"    {strip['wall']['id']:<24} x {strip['x']:5d}  y {strip['y']:5d}  w {strip['w']:5d}")
    lines.append(f"  outputs: {', '.join(publish_step.output_files(room))}")
    lines.append(f"  publish to {room.survey['publish']['folder']}")
    for step, cmds in commands(room).items():
        for argv in cmds:
            shown = [a for a in argv if a not in (sys.executable, "-X", "utf8", "room.json")]
            shown = [os.path.relpath(a, HERE) if os.path.isabs(a) else a for a in shown]
            lines.append(f"  {step:<9} {' '.join(shown)}")
    return lines


# --- step records -----------------------------------------------------------------------------------

def snapshot(work):
    state = {}
    for top in WATCHED:
        root = os.path.join(work, top)
        for dirpath, _, files in os.walk(root):
            for name in files:
                path = os.path.join(dirpath, name)
                st = os.stat(path)
                state[os.path.relpath(path, work).replace(os.sep, "/")] = (st.st_size, st.st_mtime_ns)
    return state


def digests(work, paths):
    import numpy as np  # noqa: PLC0415 - only for npz array digests
    out = {}
    for rel in sorted(paths):
        path = os.path.join(work, rel)
        entry = dict(bytes=os.path.getsize(path), sha256=sha256_file(path))
        if rel.endswith(".npz"):
            with np.load(path) as z:
                entry["arrays"] = {k: dict(dtype=str(z[k].dtype), shape=list(z[k].shape), sha256=hashlib.sha256(np.ascontiguousarray(z[k]).tobytes()).hexdigest()) for k in z.files}
        out[rel] = entry
    return out


class Recorder:
    def __init__(self, work):
        self.work = work
        self.path = os.path.join(work, "build", "steps.json")
        self.rows = []
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                self.rows = json.load(f)

    def run(self, step, argv):
        before = snapshot(self.work)
        t0 = time.time()
        print(f"\n== {step}: {' '.join(os.path.basename(a) if os.path.isabs(a) else a for a in argv)}", flush=True)
        result = subprocess.run(argv, cwd=self.work)
        after = snapshot(self.work)
        changed = [p for p, v in after.items() if before.get(p) != v]
        self.rows.append(dict(step=step, argv=argv, cwd=self.work, start=t0, seconds=round(time.time() - t0, 2),
                              exit=result.returncode, outputs=digests(self.work, changed)))
        write_json(self.path, self.rows)
        if result.returncode != 0:
            raise SystemExit(f"build-room: step {step} failed (exit {result.returncode}): {argv}")


# --- steps --------------------------------------------------------------------------------------------

def check_step(room, work, manifest, write=True):
    schema = roomlib.load(os.path.join(HERE, "room.schema.json"))
    rep = check_room.check(room.cfg, schema, manifest)
    errors = [f"config: {e}" for e in rep.errors]
    problems = errors + ([] if errors else room.build_problems())
    if not problems:
        try:
            atlas_step.layout(room)
        except ValueError as exc:
            problems.append(f"atlas: {exc}")
        cr = room.survey.get("ceilingRelief")
        if cr and cr["ppm"] != room.survey["ceilingView"]["ppm"] / 2:
            problems.append(f"survey.ceilingRelief.ppm {cr['ppm']} must be half the ceiling view's {room.survey['ceilingView']['ppm']}")
    ledger = [] if problems else room.ledger()
    if not write:
        return problems, ledger, rep
    if problems:
        refuse(problems)
    walls_bytes, ceiling_bytes = roomlib.wall_views_bytes(room.cfg), roomlib.ceiling_view_bytes(room.cfg)
    for name, data in (("views-walls.json", walls_bytes), ("views-ceiling.json", ceiling_bytes)):
        path = os.path.join(work, "views", name)
        if os.path.exists(path) and os.path.isdir(os.path.join(work, "out-walls")):
            with open(path, "rb") as f:
                if f.read() != data:
                    refuse(f"views/{name} differs from the config's and out-walls/ was rendered from it: "
                           "start again from `surfaces` in a fresh work directory")
        write_bytes(path, data)
    write_bytes(os.path.join(work, "room.json"), room.raw)
    write_bytes(os.path.join(work, "build", "room.sha256"), (room.sha256 + "  room.json\n").encode())
    write_json(os.path.join(work, "build", "stations.json"), room.station_ids())
    write_json(os.path.join(work, "build", "ledger.json"), ledger)
    write_json(os.path.join(work, "build", "plan.json"), dict(
        config=room.path, configSha256=room.sha256, methodRevision=room.revision, ledger=ledger,
        steps=commands(room), outputs=publish_step.output_files(room)))
    for line in rep.warnings:
        print("WARNING", line)
    return problems, ledger, rep


def link_inputs(room, work, src, reuse_depth=False):
    """Hard-links (or copies) the inputs another work directory has: manifest, mesh, mesh dump and
    this room's panoramas; its depth maps only with reuse_depth (by default the depth step renders
    them, so an identity run compares the renderers). Every path taken from `src`, linked now or
    before, is listed in build/linked.json for prove-build-identity.py."""
    wanted = ["data/manifest.json", "data/dollhouse.glb"]
    mesh_dir = os.path.join(src, "data", "mesh")
    if os.path.isdir(mesh_dir):
        for dirpath, _, files in os.walk(mesh_dir):
            wanted += [os.path.relpath(os.path.join(dirpath, f), src).replace(os.sep, "/") for f in files]
    for sid in room.station_ids():
        wanted.append(f"data/pano8k/{sid}_8192.webp")
        if reuse_depth:
            wanted.append(f"data/depth1024/{sid}.f32")
    record_path = os.path.join(work, "build", "linked.json")
    record = {}
    if os.path.exists(record_path):
        with open(record_path, encoding="utf-8") as f:
            record = json.load(f)
    linked = 0
    for rel in wanted:
        a, b = os.path.join(src, rel), os.path.join(work, rel)
        if os.path.exists(a) and not os.path.exists(b):
            os.makedirs(os.path.dirname(b), exist_ok=True)
            try:
                os.link(a, b)
                how = "hard link"
            except OSError:
                shutil.copyfile(a, b)
                how = "copy"
            record[rel] = dict(source=os.path.abspath(src), how=how)
            linked += 1
    write_json(record_path, record)
    depth = sum(1 for rel in record if rel.startswith("data/depth"))
    print(f"inputs: {linked} files linked from {src}" + (f"; {depth} depth maps reused, not rendered" if depth else ""))


def same_path(a, b):
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


def main():
    ap = argparse.ArgumentParser(description="Build a surveyed room's survey files from its config.")
    ap.add_argument("room", help="<slug>.room.json")
    ap.add_argument("work", help="work directory (about 3 GB for the Grand Hall)")
    ap.add_argument("--publish", help="the config's survey.publish.folder, to copy the outputs to")
    ap.add_argument("--from", dest="start", choices=STEPS, default="check")
    ap.add_argument("--to", dest="stop", choices=STEPS, default="publish")
    ap.add_argument("--inputs-from", help="another work directory whose manifest, mesh and panoramas to reuse")
    ap.add_argument("--reuse-depth", action="store_true", help="with --inputs-from, also reuse its depth maps (not rendered)")
    ap.add_argument("--twin", help="the twin's base URL, if not source.twin (file:// for tests)")
    ap.add_argument("--plan", action="store_true", help="print the gates and steps; write nothing")
    ap.add_argument("--expect-legacy", action="store_true", help="refuse unless no gate is open")
    args = ap.parse_args()
    room = Room(args.room, args.work)
    work = room.work
    dest = os.path.abspath(args.publish) if args.publish else None
    manifest_path = os.path.join(work, "data", "manifest.json")
    if not os.path.exists(manifest_path) and args.inputs_from:
        manifest_path = os.path.join(args.inputs_from, "data", "manifest.json")
    manifest = roomlib.load(manifest_path) if os.path.exists(manifest_path) else None
    if args.plan:
        problems, ledger, rep = check_step(room, work, manifest, write=False)
        print("\n".join(describe_plan(room, problems, ledger)))
        sys.exit(1 if problems else 0)
    # Refusals that need only the arguments and the config come before anything is written.
    if dest and legacy.depth_override():
        refuse(f"{legacy.DEPTH_ENV} is set: test-sized depth maps are never published")
    if dest and os.environ.get(NODE_ENV):
        refuse(f"{NODE_ENV} is set: a published relief is meshed with this checkout's own meshoptimizer")
    if dest and not same_path(dest, os.path.join(REPO, room.survey["publish"]["folder"])):
        refuse(f"--publish {dest} is not the config's survey.publish.folder ({room.survey['publish']['folder']})")
    if args.reuse_depth and not args.inputs_from:
        refuse("--reuse-depth needs --inputs-from")
    first, last = STEPS.index(args.start), STEPS.index(args.stop)
    if first > last:
        refuse(f"--from {args.start} comes after --to {args.stop}")
    if args.start in ("windows", "corners") and any(o["glazing"] == "clear" for o in room.cfg["openings"] if o["kind"] == "window"):
        refuse(f"--from {args.start}: the clear glass test reads proj/wall-*.npz, which the corners step rewrites in place; rerun --from project")
    os.makedirs(work, exist_ok=True)
    for d in ("proj", "relief", "build", "views", "data"):
        os.makedirs(os.path.join(work, d), exist_ok=True)
    problems, ledger, rep = check_step(room, work, manifest)
    if args.expect_legacy and ledger:
        refuse([f"--expect-legacy, but the config opens gate {r['gate']} at {r['where']}" for r in ledger])
    print(f"ledger: {len(ledger)} gates" + "".join(f"\n  {r['gate']} {r['where']}: {r['what']}" for r in ledger))
    rec = Recorder(work)
    cmds = commands(room)
    for step in STEPS[max(first, 1):last + 1]:
        if step == "inputs":
            if args.inputs_from:
                link_inputs(room, work, args.inputs_from, args.reuse_depth)
            rec.run(step, cmds["inputs"][0] + ([args.twin] if args.twin else []))
            if not os.path.exists(os.path.join(work, "data", "mesh", "indices.u32")):
                rec.run(step, ["node", legacy.survey_path("dump-mesh.mjs"), "data/dollhouse.glb", "data/mesh"])
        elif step == "relief":
            write_json(os.path.join(work, "build", "relief-walls.json"),
                       dict(relief_step.walls_job(room), record="build/relief-walls.node.json"))
            if "ceilingRelief" in room.survey:
                write_json(os.path.join(work, "build", "relief-ceiling.json"),
                           dict(relief_step.ceiling_job(room), record="build/relief-ceiling.node.json"))
            for argv in cmds["relief"]:
                rec.run(step, argv)
        elif step == "publish":
            cwd = os.getcwd()
            os.chdir(work)
            try:
                if dest:
                    publish_step.publish(room, dest)
                else:
                    publish_step.write_record(room)
                    for name in publish_step.output_files(room):
                        path = os.path.join("proj", name)
                        print(f"{sha256_file(path)[:16] if os.path.exists(path) else 'missing         '}  {name}")
            finally:
                os.chdir(cwd)
        else:
            for argv in cmds[step]:
                rec.run(step, argv)
    print("\n== Done")


if __name__ == "__main__":
    main()
