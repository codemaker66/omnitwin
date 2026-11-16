"""Builds a surveyed room's survey files from its config: fetch, depth renders, the walls'
corners, labels and photographs, ceiling, dome and floor projection, windows, atlas packing, wall
depth and relief, ceiling, floor, the walls' detail tiles, publish. The steps and their order are
tools/grand-hall-survey/build.sh's.

    python -X utf8 tools/surveyed-rooms/build-room.py <room.json> <work-dir> [--publish DIR]
        [--from STEP] [--to STEP] [--inputs-from DIR [--reuse-depth]] [--twin URL] [--plan]
        [--expect-legacy] [--relief keep|rebuild] [--list] [--only ID] [--resume]

Steps (each runs in <work-dir>, one process per old script invocation, as build.sh runs them):
  check     validate the config (check_room.py and the build's own checks); write room.json,
            views/ (roomlib, LF), build/stations.json, build/ledger.json, build/plan.json
  inputs    data/: manifest, dollhouse mesh, the room's 8K panoramas (hash-checked), the mesh dump
  depth     data/depth1024/: each station's distance cubemap
  surfaces  out-walls/: the walls' and ceiling's measured positions
  corners   out-walls/*.fixed.f32: the corners' fins moved back onto their walls
  labels    proj/labels-<wall>.npz: each block's sharpest station (the slowest step)
  walls     proj/<view>.fine.npz and .npz: the walls coloured from those stations, seams levelled;
            proj/canvas-<wall>.npz for the walls with `canvas` edits
  project   proj/: panoramas onto the ceiling, each dome and the floor
  windows   proj/<wall>-glass.npy, -layered.npy, build/glass.json (with the glass checked
            against the scan)
  atlas     the wall atlas WebPs
  relief    relief/*.f32 and the GHR1 file(s): walls, and the ceiling when ceilingRelief is set
  overhead  the ceiling and dome WebPs
  floor     the flattened floor and its WebPs
  detail    proj/detail-<wall>.npy and proj/detail/: the walls at survey.detail's texel, in tiles
  publish   build/survey.json; with --publish, copies survey.outputs (the detail folder, and
            survey.json for rooms that publish it) to DIR, which must be the config's
            survey.publish.folder

Inputs and depth maps already in the work directory are kept. --inputs-from links (or copies)
another work directory's manifest, mesh, mesh dump and this room's panoramas (the inputs step
then hash-checks the manifest's files against it); its depth maps only with --reuse-depth, so by
default the depth step renders every map and an identity run compares them. Every linked path
is listed in build/linked.json, and prove-build-identity.py reports those as linked, not as
identical. --from/--to run a span of steps (check always runs). --plan prints the gates the
config opens and the steps, and writes nothing. --expect-legacy refuses to run unless the ledger
is empty (the Grand Hall's identity run). --publish refuses test-sized depth maps (B21), another
checkout's node modules (B22) and glass the scan disagrees with (build/glass.json).

One sub-command at a time. --list prints every sub-command of the build with its id, <step>:<n>
(labels:3 is the third wall's labels), and writes nothing. --only ID runs exactly that one, after
the check and whatever its step needs first (the inputs' links, the relief's job files), and
records it in build/steps.json like any other; publish:1 writes the record and, with --publish,
publishes. --resume skips a sub-command whose last record ended with exit 0 for the same command
and the same config, when no sub-command it may depend on has run since and every file it wrote
is still there with the recorded size and SHA-256; so a build stopped anywhere picks up at the
first sub-command that is not done. A changed config skips nothing (the check and the steps' own
refusals then run as ever): say where to start with --from. A caller that must not hold a shared
machine for a whole build wraps each --only (or each --resume run it lets finish) in its own lock.

A room whose config sets survey.atlas.alphaFrom to "published" (the Grand Hall) is published as
build.sh publishes it: the atlas keeps the alpha of the atlas already in DIR, the relief in DIR
stands (--relief rebuild meshes this build's instead) and check-atlas.py must pass before anything
is copied. Without --publish such a room builds its own glass and relief, as build.sh does.

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

STEPS = ["check", "inputs", "depth", "surfaces", "corners", "labels", "walls", "project", "windows", "atlas", "relief", "overhead",
         "floor", "detail", "publish"]
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

def pinned(room, dest):
    """Whether this run publishes over an atlas whose alpha it keeps (build.sh with a publish
    folder): survey.atlas.alphaFrom is "published" and --publish names the folder."""
    return bool(dest) and room.survey["atlas"].get("alphaFrom") == "published"


def commands(room, dest=None, relief="keep"):
    """Every command the build runs, by step (argv lists; py(...) runs roombuild/step.py)."""
    s = room.survey
    py = lambda *a: [sys.executable, "-X", "utf8", STEP_PY, a[0], "room.json", *a[1:]]  # noqa: E731
    canvases = room.canvases()
    out = {
        "inputs": [py("inputs"), ["node", legacy.survey_path("dump-mesh.mjs"), "data/dollhouse.glb", "data/mesh"]],
        "depth": [["node", os.path.join(HERE, "render-depth-room.mjs"), "build/stations.json", str(DEPTH_SIZE), "data/depth1024"]],
        "surfaces": [["node", legacy.survey_path("render.mjs"), "views/views-walls.json", "out-walls"],
                     ["node", legacy.survey_path("render.mjs"), "views/views-ceiling.json", "out-walls"]],
        "corners": [py("corners")],
        "labels": [py("labels", w["name"]) for w in room.order],
        "walls": [py("wall-photo", w["name"]) for w in room.order] + [py("canvases", w["name"]) for w in room.order if w["name"] in canvases],
        "project": [py("project-ceiling")] + [py("project-dome", d["id"]) for d in room.cfg["ceiling"].get("domes", [])] + [py("project-floor")],
        "windows": [py("windows")],
        "atlas": [py("atlas", *(["--alpha-from", dest] if pinned(room, dest) else []))],
        "relief": [py("wall-depth"), ["node", os.path.join(HERE, "relief-mesh-room.mjs"), "build/relief-walls.json"]],
        "overhead": [py("overhead", "proj")],
        "floor": [py("flatten-floor", "proj/floor.npz", "proj/floor-flat.npz", str(s["floorPhoto"]["ppm"])),
                  py("pack-floor", "proj/floor-flat.npz", "proj")],
        "detail": [py("detail", w["name"]) for w in room.order] + [py("pack-detail")],
    }
    if pinned(room, dest):
        # build.sh against the published survey: the published relief stands unless RELIEF=rebuild,
        # and check-atlas.py compares the atlas (and the relief) with what it replaces
        if relief != "rebuild":
            out["relief"] = []
        out["relief"].append([sys.executable, "-X", "utf8", legacy.survey_path("check-atlas.py"), "proj", dest, "--json",
                              "proj/check-atlas.json", "--alpha-pinned", *(["--relief-changed"] if relief == "rebuild" else [])])
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
    lines.append(f"  outputs: {', '.join(publish_step.output_files(room))}, {publish_step.detail_folder(room)}/")
    lines.append(f"  publish to {room.survey['publish']['folder']}")
    for sub in sub_commands(room):
        lines.append(f"  {sub['id']:<12} {shown(sub['argv'])}")
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

    def run(self, step, argv, sub=None, config=None):
        """Runs one sub-command in the work directory and appends its record: its id (<step>:<n>),
        the config it ran for, when, how long, its exit status and the files it wrote."""
        before = snapshot(self.work)
        t0 = time.time()
        print(f"\n== {sub or step}: {' '.join(os.path.basename(a) if os.path.isabs(a) else a for a in argv)}", flush=True)
        result = subprocess.run(argv, cwd=self.work)
        after = snapshot(self.work)
        changed = [p for p, v in after.items() if before.get(p) != v]
        self.rows.append(dict(id=sub, step=step, argv=argv, cwd=self.work, config=config, start=t0, seconds=round(time.time() - t0, 2),
                              exit=result.returncode, outputs=digests(self.work, changed)))
        write_json(self.path, self.rows)
        if result.returncode != 0:
            raise SystemExit(f"build-room: {sub or step} failed (exit {result.returncode}): {argv}")

    def latest(self, sub):
        """The last record of a sub-command, or None."""
        return next((row for row in reversed(self.rows) if row.get("id") == sub), None)


# --- sub-commands: one at a time, and picking a stopped build up ------------------------------------------

# Sub-commands that do not read what earlier ones of their own step wrote: one per wall or surface.
FAN_OUT = ("render.mjs", "labels", "wall-photo", "detail", "project-ceiling", "project-dome", "project-floor")


def sub_commands(room, dest=None, relief="keep", twin=None):
    """Every sub-command of the build in order: id (<step>:<n>, counted from 1 within the step, so
    an id names the same command for as long as the config's walls and domes stay as they are),
    step, argv, and whether it stands apart from the earlier sub-commands of its own step.
    publish:1 has no argv: the driver writes the record (and publishes) itself."""
    out = []
    cmds = commands(room, dest, relief)
    for step in STEPS[1:-1]:
        for n, argv in enumerate(cmds[step], 1):
            key = argv[4] if STEP_PY in argv else os.path.basename(argv[1])
            if key == "inputs" and twin:
                argv = argv + [twin]
            out.append(dict(id=f"{step}:{n}", step=step, argv=argv, apart=key in FAN_OUT))
    out.append(dict(id="publish:1", step="publish", argv=None, apart=False))
    return out


def shown(argv):
    """A command as the plan and the list print it."""
    if argv is None:
        return "build/survey.json; with --publish, the outputs"
    words = [a for a in argv if a not in (sys.executable, "-X", "utf8", "room.json")]
    return " ".join(os.path.relpath(a, HERE) if os.path.isabs(a) and a.startswith(os.path.dirname(HERE)) else a for a in words)


def fresh(rec, subs, index, config):
    """(True, "") when sub-command `index` need not run again: its last record ended with exit 0
    for this command and this config, nothing it may depend on has run since (any earlier step's
    sub-command, and the earlier ones of its own step unless it stands apart from them), and every
    file it wrote is still there with the recorded size and SHA-256. Else (False, why)."""
    sub = subs[index]
    row = rec.latest(sub["id"])
    if row is None:
        return False, "not run yet"
    if row["exit"] != 0:
        return False, f"its last run failed (exit {row['exit']})"
    if row["argv"] != sub["argv"]:
        return False, "its command changed"
    if row.get("config") != config:
        return False, "the config changed since it ran"
    for other in subs[:index]:
        if other["step"] == sub["step"] and sub["apart"]:
            continue
        before = rec.latest(other["id"])
        if before is not None and before["start"] > row["start"]:
            return False, f"{other['id']} ran after it"
    for rel, want in row["outputs"].items():
        path = os.path.join(rec.work, rel)
        if not os.path.exists(path):
            return False, f"{rel} is gone"
        if os.path.getsize(path) != want["bytes"] or sha256_file(path) != want["sha256"]:
            return False, f"{rel} changed"
    return True, ""


def run_subs(rec, subs, selected, config, resume=False, prepare=None, publish=None):
    """Runs the selected sub-commands in order through the recorder. `prepare(step)` is called
    once before the first sub-command of a step that runs; `publish()` stands for publish:1. With
    `resume`, a sub-command that is fresh() is skipped. Returns the ids run and the ids skipped."""
    ran, skipped, prepared = [], [], set()
    for sub in selected:
        if sub["argv"] is None:
            if publish is not None:
                publish()
            ran.append(sub["id"])
            continue
        if resume:
            ok, why = fresh(rec, subs, subs.index(sub), config)
            if ok:
                print(f"\n== {sub['id']}: done before, its files are as it left them: skipped", flush=True)
                skipped.append(sub["id"])
                continue
            print(f"\n== {sub['id']}: to run ({why})", flush=True)
        if prepare is not None and sub["step"] not in prepared:
            prepare(sub["step"])
            prepared.add(sub["step"])
        if os.path.basename(sub["argv"][1]) == "dump-mesh.mjs" and os.path.exists(os.path.join(rec.work, "data", "mesh", "indices.u32")):
            print(f"\n== {sub['id']}: data/mesh is there: kept", flush=True)
            skipped.append(sub["id"])
            continue
        rec.run(sub["step"], sub["argv"], sub["id"], config)
        ran.append(sub["id"])
    return ran, skipped


# --- steps --------------------------------------------------------------------------------------------

def open_room(path, work, manifest):
    """The config as a Room, with the checker's report on it, or a refusal that names what is wrong.

    Room indexes the config's blocks as it is built, and so does everything after it. So the
    checker reads the config first: a file that is not there, is not JSON or is not well-formed is
    refused in the checker's own words, not by a KeyError from wherever the build first reached
    for the missing part."""
    try:
        cfg = check_room.read_config(path)
    except check_room.Unreadable as exc:
        refuse(str(exc))
    rep = check_room.check(cfg, roomlib.load(os.path.join(HERE, "room.schema.json")), manifest)
    if rep.errors:
        refuse([f"config: {e}" for e in rep.errors])
    return Room(path, work), rep


def check_step(room, work, manifest, write=True, rep=None):
    """The config's problems and its ledger; with `write`, also the check's files. `rep` is the
    checker's report on this config and manifest, when the caller already has it."""
    if rep is None:
        rep = check_room.check(room.cfg, roomlib.load(os.path.join(HERE, "room.schema.json")), manifest)
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
        steps=commands(room), outputs=publish_step.output_files(room), detail=publish_step.detail_folder(room)))
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
    ap.add_argument("--list", action="store_true", help="print every sub-command with its id (<step>:<n>); write nothing. With --resume, also whether it would run")
    ap.add_argument("--only", metavar="ID", help="run exactly one sub-command (an id from --list), after the check")
    ap.add_argument("--resume", action="store_true",
                    help="skip a sub-command whose last run succeeded for this config and command, with nothing before it run since and its files unchanged")
    ap.add_argument("--expect-legacy", action="store_true", help="refuse unless no gate is open")
    ap.add_argument("--relief", choices=["keep", "rebuild"], default="keep",
                    help="publishing over a pinned atlas (survey.atlas.alphaFrom): keep the published relief (default) or mesh this build's")
    args = ap.parse_args()
    work = os.path.abspath(args.work)
    dest = os.path.abspath(args.publish) if args.publish else None
    manifest_path = os.path.join(work, "data", "manifest.json")
    if not os.path.exists(manifest_path) and args.inputs_from:
        manifest_path = os.path.join(args.inputs_from, "data", "manifest.json")
    manifest = roomlib.load(manifest_path) if os.path.exists(manifest_path) else None
    # The config is checked before anything reads it, in every mode: what follows may take a
    # well-formed config, and (past the plan) the survey blocks a build needs, for granted.
    room, rep = open_room(args.room, work, manifest)
    problems, ledger, rep = check_step(room, work, manifest, write=False, rep=rep)
    if args.plan:
        print("\n".join(describe_plan(room, problems, ledger)))
        sys.exit(1 if problems else 0)
    if problems:
        refuse(problems)
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
    if args.only and (args.start != "check" or args.stop != "publish"):
        refuse("--only runs one sub-command: leave --from and --to out")
    if args.only or args.list:
        subs = sub_commands(room, dest, args.relief, args.twin)
        if args.only and args.only not in [s["id"] for s in subs]:
            refuse(f"--only {args.only}: no such sub-command (--list prints them)")
    if args.list:
        rec = Recorder(work)
        for i, sub in enumerate(subs):
            state = ""
            if args.resume and sub["argv"] is not None:
                ok, why = fresh(rec, subs, i, room.sha256)
                state = "  [done]" if ok else f"  [to run: {why}]"
            print(f"{sub['id']:<12} {shown(sub['argv'])}{state}")
        sys.exit(0)
    if pinned(room, dest) and not os.path.exists(os.path.join(dest, room.survey["outputs"]["walls"][0]["file"])):
        refuse(f"survey.atlas.alphaFrom is 'published', but {dest} holds no {room.survey['outputs']['walls'][0]['file']} to take the alpha from")
    os.makedirs(work, exist_ok=True)
    for d in ("proj", "relief", "build", "views", "data"):
        os.makedirs(os.path.join(work, d), exist_ok=True)
    problems, ledger, rep = check_step(room, work, manifest, rep=rep)
    if args.expect_legacy and ledger:
        refuse([f"--expect-legacy, but the config opens gate {r['gate']} at {r['where']}" for r in ledger])
    print(f"ledger: {len(ledger)} gates" + "".join(f"\n  {r['gate']} {r['where']}: {r['what']}" for r in ledger))
    rec = Recorder(work)
    subs = sub_commands(room, dest, args.relief, args.twin)

    def prepare(step):
        """What a step needs before any of its sub-commands, whichever of them runs."""
        if step == "inputs" and args.inputs_from:
            link_inputs(room, work, args.inputs_from, args.reuse_depth)
        if step == "relief":
            if pinned(room, dest) and args.relief == "keep":
                shutil.copyfile(os.path.join(dest, room.survey["outputs"]["relief"]), os.path.join(work, "proj", room.survey["outputs"]["relief"]))
                print(f"\n== relief: the published {room.survey['outputs']['relief']} stands (--relief rebuild meshes this build's)")
            write_json(os.path.join(work, "build", "relief-walls.json"),
                       dict(relief_step.walls_job(room), record="build/relief-walls.node.json"))
            if "ceilingRelief" in room.survey:
                write_json(os.path.join(work, "build", "relief-ceiling.json"),
                           dict(relief_step.ceiling_job(room), record="build/relief-ceiling.node.json"))

    def publish():
        cwd = os.getcwd()
        os.chdir(work)
        try:
            if dest:
                publish_step.publish(room, dest)
            else:
                publish_step.write_record(room)
                for name in publish_step.output_files(room) + [publish_step.detail_folder(room) + "/index.json"]:
                    path = os.path.join("proj", name)
                    print(f"{sha256_file(path)[:16] if os.path.exists(path) else 'missing         '}  {name}")
        finally:
            os.chdir(cwd)

    selected = [s for s in subs if (s["id"] == args.only if args.only else max(first, 1) <= STEPS.index(s["step"]) <= last)]
    ran, skipped = run_subs(rec, subs, selected, room.sha256, args.resume, prepare, publish)
    print(f"\n== Done: {len(ran)} run" + (f", {len(skipped)} skipped" if skipped else ""))


if __name__ == "__main__":
    main()
