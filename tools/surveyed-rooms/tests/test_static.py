"""T0: the proofs that need no build (seconds).

- prove-build-identity.py --static on the Grand Hall: every config-derived table equals the old
  scripts' literals; and it notices a changed value.
- prove-grand-hall.py still PROVED after the roomlib and survey.outputs changes.
- build-room.py --plan: the Grand Hall opens no gate; the Saloon opens exactly the expected ones;
  --expect-legacy refuses the Saloon; a config missing survey blocks is refused by name.
- check_room.py's new checks fire (relief ids, view depth, glass outline, outputs, occluders).
- the prover's self-test (including a linked depth map reported as linked, not identical).
- the driver's refusals before anything is written (--reuse-depth without --inputs-from, --publish
  with another checkout's node modules, a pinned atlas with nothing published to take the alpha
  from), publishing a pinned atlas as build.sh does, the canvases' walls,
  the config refusals (a recess on the photo, a glass block the build would ignore), the inputs
  link (depth maps only with --reuse-depth, every link recorded), publishing refused on a glass
  disagreement, and a CRLF checkout of a config hashing as its LF one.
The --static proofs and the manifest check need the twin's manifest (SURVEYED_ROOMS_MANIFEST);
without it they are skipped and say so.
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOMS = os.path.dirname(HERE)
sys.path.insert(0, ROOMS)
import check_room  # noqa: E402
import roomlib  # noqa: E402
from roombuild.context import Room  # noqa: E402

SCRATCH = os.environ.get("SURVEYED_ROOMS_TEST_SCRATCH", os.path.join(tempfile.gettempdir(), "surveyed-rooms-tests"))
T0 = os.path.join(SCRATCH, "t0")
GH = os.path.join(ROOMS, "grand-hall.room.json")
SALOON = os.path.join(ROOMS, "saloon.room.json")
MANIFEST = os.environ.get("SURVEYED_ROOMS_MANIFEST")
ENV = {k: v for k, v in os.environ.items() if k not in ("SURVEYED_ROOMS_TEST_DEPTH_SIZE", "SURVEYED_ROOMS_NODE_ROOT")}


def need_manifest(test):
    return unittest.skipUnless(MANIFEST and os.path.exists(MANIFEST), "SURVEYED_ROOMS_MANIFEST (the twin's manifest.json) is not set")(test)


def py(*args, cwd=ROOMS):
    return subprocess.run([sys.executable, "-X", "utf8", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", env=ENV)


def variant(path, name, change):
    with open(path, encoding="utf-8") as f:
        room = json.load(f)
    change(room)
    os.makedirs(T0, exist_ok=True)
    out = os.path.join(T0, name)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(room, f, indent=1)
    return out, room


def check(room, manifest=True):
    schema = roomlib.load(os.path.join(ROOMS, "room.schema.json"))
    return check_room.check(room, schema, roomlib.load(MANIFEST) if manifest and MANIFEST and os.path.exists(MANIFEST) else None)


class StaticProof(unittest.TestCase):
    @need_manifest
    def test_grand_hall_static_identity(self):
        r = py("prove-build-identity.py", "--static", GH, "--manifest", MANIFEST)
        self.assertEqual(r.returncode, 0, r.stdout[-4000:] + r.stderr[-2000:])
        self.assertRegex(r.stdout, r"\n  \d+ checks, 0 differ")
        self.assertGreaterEqual(int(re.search(r"(\d+) checks", r.stdout).group(1)), 80)

    @need_manifest
    def test_static_notices_a_changed_value(self):
        changes = {
            "occluder": lambda r: r["occluders"][3].__setitem__("radius", 0.121),
            "patch": lambda r: next(e for e in r["edits"] if e["type"] == "patch").__setitem__("about", 10.567),
            "floor": lambda r: r["survey"]["floorPhoto"].__setitem__("ppm", 121),
            "atlas": lambda r: r["survey"]["atlas"]["placement"].reverse(),
            "relief": lambda r: r["survey"]["relief"].__setitem__("order", ["window", "door", "end", "fireplace"]),
            "projection": lambda r: r["survey"]["projection"]["dome"].__setitem__("cosMin", 0.11),
            "wall visibility": lambda r: r["survey"]["projection"]["walls"].__setitem__("maxDist", 15.0),
            "canvas": lambda r: next(e for e in r["edits"] if e["type"] == "canvas")["u"].__setitem__(0, 4.5),
            "detail": lambda r: r["survey"]["detail"].__setitem__("gutter", 4),
            "station": lambda r: r["stations"].pop(),
            "top": lambda r: r["survey"]["wallViews"]["heightRange"].__setitem__(1, 7.05),
        }
        for name, change in changes.items():
            path, _ = variant(GH, f"gh-{name}.room.json", change)
            r = py("prove-build-identity.py", "--static", path, "--manifest", MANIFEST)
            self.assertEqual(r.returncode, 1, f"--static missed a changed {name}")

    def test_prove_grand_hall_still_proved(self):
        r = py("prove-grand-hall.py", "--scratch", os.path.join(T0, "prove"))
        self.assertEqual(r.returncode, 0, r.stdout[-3000:])
        self.assertIn("PROVED", r.stdout)

    def test_prover_self_test(self):
        r = py("prove-build-identity.py", "--self-test", T0)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:])
        self.assertIn("SELF-TEST PASSED", r.stdout)


class Plans(unittest.TestCase):
    def test_grand_hall_opens_no_gate(self):
        r = py("build-room.py", GH, os.path.join(T0, "plan-gh"), "--plan")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("ledger: empty", r.stdout)
        self.assertFalse(os.path.exists(os.path.join(T0, "plan-gh")), "--plan wrote files")

    def test_saloon_gates(self):
        r = py("build-room.py", SALOON, os.path.join(T0, "plan-saloon"), "--plan")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        gates = Counter(re.findall(r"^    (B\d+) ", r.stdout, re.M))
        self.assertEqual(gates, Counter({"B5": 4, "B8": 4, "B6": 8, "B9": 8, "B7": 1, "B10": 3, "B14": 1, "B16": 1, "B17": 1, "B18": 1, "B23": 1, "B24": 1}))
        self.assertRegex(r.stdout, r"B23 +wall fireplace .*1556 columns, 1557 rounded")
        self.assertRegex(r.stdout, r"B24 +wall views .*up to 8 a tile")
        self.assertIn("atlas 4096 x 2304, strips 1111 high", r.stdout)
        for wall in ("window-front-return", "window-rear-return", "fireplace-rear-return", "fireplace-front-return"):
            self.assertRegex(r.stdout, rf"B5 +wall {wall} ")

    def test_expect_legacy_refuses_the_saloon(self):
        r = py("build-room.py", SALOON, os.path.join(T0, "legacy-saloon"), "--to", "check", "--expect-legacy")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--expect-legacy, but the config opens gate B5", r.stdout + r.stderr)

    def test_missing_survey_blocks_are_named(self):
        def strip(room):
            for key in ("relief", "outputs", "floorPhoto", "ceilingRelief", "detail"):
                room["survey"].pop(key)
        path, _ = variant(SALOON, "saloon-unready.room.json", strip)
        r = py("build-room.py", path, os.path.join(T0, "plan-unready"), "--plan")
        self.assertEqual(r.returncode, 1)
        for name in ("survey.relief is missing", "survey.outputs is missing", "survey.floorPhoto is missing", "survey.detail is missing"):
            self.assertIn(name, r.stdout)

    def test_publish_must_be_the_configs_folder(self):
        r = py("build-room.py", GH, os.path.join(T0, "publish-gh"), "--to", "check", "--publish", os.path.join(T0, "elsewhere"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("is not the config's survey.publish.folder", r.stdout + r.stderr)


class CheckRoom(unittest.TestCase):
    def test_both_configs_pass(self):
        for path in (GH, SALOON):
            rep = check(roomlib.load(path), manifest=False)
            self.assertEqual((rep.errors, rep.warnings), ([], ["stations: not placed (no --manifest)"]), path)

    @need_manifest
    def test_both_configs_pass_with_the_manifest(self):
        for path in (GH, SALOON):
            rep = check(roomlib.load(path))
            self.assertEqual((rep.errors, rep.warnings), ([], []), path)

    def errors(self, change, manifest=False):
        _, room = variant(SALOON, "saloon-check.room.json", change)
        return "\n".join(check(room, manifest).errors)

    def test_long_relief_id(self):
        def drop(room):
            room["walls"]["segments"][1].pop("survey")
        self.assertIn("GHR1 relief id 'window-front-end' is 16 bytes", self.errors(drop))

    def test_views_too_shallow_for_the_relief(self):
        self.assertIn("not relief.depthRange", self.errors(lambda r: r["survey"]["wallViews"].__setitem__("far", 1.25)))

    def test_glass_outside_the_face_opening(self):
        def wide(room):
            room["openings"][0]["glass"]["width"] = 2.0
        self.assertIn("exceeds the face opening", self.errors(wide))

    def test_glass_planes_out_of_order(self):
        def bad(room):
            room["openings"][0]["glass"]["planes"][0]["below"] = 6.0
        self.assertIn("plane 0 ends at 6.0", self.errors(bad))

    def test_ceiling_relief_outside_the_view(self):
        self.assertIn("not inside what the ceiling view sees",
                      self.errors(lambda r: r["survey"]["ceilingRelief"].__setitem__("heightRange", [5.0, 5.9])))

    def test_outputs_named_twice(self):
        def twice(room):
            room["survey"]["outputs"]["floor"][1]["file"] = "walls-4096.webp"
        self.assertIn("walls-4096.webp is named twice", self.errors(twice))

    def test_fitting_without_occluder(self):
        def strip(room):
            room["occluders"] = [o for o in room["occluders"] if o["fitting"] != "electrolier-rear"]
        self.assertIn("fitting electrolier-rear: no occluder", self.errors(strip))

    def test_copy_patch_source_must_fit(self):
        def copy(room):
            room["edits"].append(dict(type="patch", wall="fireplace-rear-end", u=[0.2, 1.4], v=[0.0, 1.0], mode="copy",
                                      **{"from": dict(wall="fireplace-front-end", u=1.2)}, applies=["photo"]))
        self.assertIn("runs outside wall fireplace-front-end", self.errors(copy))


def load_driver():
    spec = importlib.util.spec_from_file_location("build_room", os.path.join(ROOMS, "build-room.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Refusals(unittest.TestCase):
    def fresh(self, name):
        work = os.path.join(T0, name)
        shutil.rmtree(work, ignore_errors=True)
        return work

    def test_publishing_a_pinned_atlas_follows_build_sh(self):
        """survey.atlas.alphaFrom "published" (the Grand Hall): with a publish folder the atlas takes
        that folder's alpha, the published relief stands and check-atlas.py runs; --relief rebuild
        meshes the relief and tells check-atlas.py so. Without a folder, and for any other room,
        the commands are the plain ones."""
        drv = load_driver()
        gh, saloon = Room(GH, T0), Room(SALOON, T0)
        plain = drv.commands(gh)
        self.assertEqual(plain["atlas"][0][-1], "room.json")
        self.assertEqual([os.path.basename(c[1]) if c[0] == "node" else c[4] for c in plain["relief"]], ["wall-depth", "relief-mesh-room.mjs"])
        keep = drv.commands(gh, "DIR")
        self.assertEqual(keep["atlas"][0][-2:], ["--alpha-from", "DIR"])
        self.assertEqual([os.path.basename(c[3]) for c in keep["relief"]], ["check-atlas.py"])
        self.assertEqual(keep["relief"][0][4:], ["proj", "DIR", "--json", "proj/check-atlas.json", "--alpha-pinned"])
        rebuild = drv.commands(gh, "DIR", "rebuild")
        self.assertEqual(len(rebuild["relief"]), 3)
        self.assertEqual(rebuild["relief"][-1][-2:], ["--alpha-pinned", "--relief-changed"])
        self.assertEqual(drv.commands(saloon, "DIR"), drv.commands(saloon))
        for step in ("corners", "labels", "walls", "detail"):
            self.assertEqual(keep[step], plain[step])

    def test_publishing_a_pinned_atlas_needs_the_published_atlas(self):
        work = self.fresh("publish-pinned")
        variant_path, room = variant(GH, "gh-elsewhere.room.json", lambda r: r["survey"]["publish"].__setitem__("folder", "tools/surveyed-rooms/tests"))
        folder = os.path.join(os.path.dirname(os.path.dirname(ROOMS)), room["survey"]["publish"]["folder"])
        r = py("build-room.py", variant_path, work, "--to", "check", "--publish", folder)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("holds no walls-4096.webp to take the alpha from", r.stdout + r.stderr)
        self.assertFalse(os.path.exists(work), "the refusal wrote files")

    def test_a_canvas_edit_adds_its_wall_to_the_walls_step(self):
        drv = load_driver()
        self.assertEqual([c[6] for c in drv.commands(Room(GH, T0))["walls"] if c[4] == "canvases"], ["end", "fire"])
        self.assertEqual([c for c in drv.commands(Room(SALOON, T0))["walls"] if c[4] == "canvases"], [])
        self.assertEqual(Room(GH, T0).canvases(), {"fire": [("fire-portrait", (4.489, 6.116, 1.911, 4.364), True)],
                                                   "end": [("end-portrait", (4.569, 6.069, 2.226, 4.521), True)]})

    def test_reuse_depth_needs_inputs_from(self):
        work = self.fresh("reuse-depth")
        r = py("build-room.py", GH, work, "--reuse-depth", "--to", "check")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--reuse-depth needs --inputs-from", r.stdout + r.stderr)
        self.assertFalse(os.path.exists(work))

    def test_publish_refuses_another_checkouts_node_modules(self):
        work = self.fresh("publish-node-root")
        folder = os.path.join(os.path.dirname(os.path.dirname(ROOMS)), roomlib.load(GH)["survey"]["publish"]["folder"])
        r = subprocess.run([sys.executable, "-X", "utf8", "build-room.py", GH, work, "--to", "check", "--publish", folder],
                           cwd=ROOMS, capture_output=True, text=True, encoding="utf-8", env=dict(ENV, SURVEYED_ROOMS_NODE_ROOT=ROOMS))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("SURVEYED_ROOMS_NODE_ROOT is set", r.stdout + r.stderr)
        self.assertFalse(os.path.exists(work))

    def test_ledger_records_borrowed_node_modules(self):
        saved = {k: os.environ.pop(k, None) for k in ("SURVEYED_ROOMS_NODE_ROOT", "SURVEYED_ROOMS_TEST_DEPTH_SIZE")}
        os.environ["SURVEYED_ROOMS_NODE_ROOT"] = ROOMS
        try:
            self.assertEqual([(r["gate"], r["where"]) for r in Room(GH, T0).ledger()], [("B22", "relief")])
        finally:
            os.environ.pop("SURVEYED_ROOMS_NODE_ROOT")
            os.environ.update({k: v for k, v in saved.items() if v is not None})

    def test_config_refusals(self):
        def recess_on_photo(room):
            next(e for e in room["edits"] if e["type"] == "recess")["applies"].append("photo")

        def glass_on_clear(room):
            room["openings"][0]["glass"] = dict(planes=[dict(depth=0.9)])
        for change, want in ((recess_on_photo, "a recess changes the relief only"),
                             (glass_on_clear, "its glass block is read only for")):
            path, _ = variant(GH, "gh-refused.room.json", change)
            problems = "\n".join(Room(path, T0).build_problems())
            self.assertIn(want, problems)
        for path in (GH, SALOON):
            self.assertEqual(Room(path, T0).build_problems(), [], path)

    def test_crlf_checkout_hashes_as_lf(self):
        with open(GH, "rb") as f:
            raw = f.read()
        os.makedirs(T0, exist_ok=True)
        path = os.path.join(T0, "gh-crlf.room.json")
        with open(path, "wb") as f:
            f.write(raw.replace(b"\n", b"\r\n"))
        self.assertEqual(Room(path, T0).sha256, Room(GH, T0).sha256)

    def test_inputs_link_depth_maps_only_when_asked(self):
        drv = load_driver()
        src = self.fresh("link-src")
        files = ["data/manifest.json", "data/dollhouse.glb", "data/mesh/indices.u32"]
        for sid in ("scan_000", "scan_001"):
            files += [f"data/pano8k/{sid}_8192.webp", f"data/depth1024/{sid}.f32"]
        for rel in files:
            os.makedirs(os.path.dirname(os.path.join(src, rel)), exist_ok=True)
            with open(os.path.join(src, rel), "wb") as f:
                f.write(rel.encode())
        room = Room(GH, T0)
        for reuse in (False, True):
            work = self.fresh(f"link-{reuse}")
            os.makedirs(os.path.join(work, "build"))
            drv.link_inputs(room, work, src, reuse)
            with open(os.path.join(work, "build", "linked.json"), encoding="utf-8") as f:
                record = json.load(f)
            depth = sorted(r for r in record if r.startswith("data/depth"))
            self.assertEqual(depth, ["data/depth1024/scan_000.f32", "data/depth1024/scan_001.f32"] if reuse else [])
            self.assertEqual(os.path.exists(os.path.join(work, "data", "depth1024", "scan_000.f32")), reuse)
            self.assertIn("data/pano8k/scan_001_8192.webp", record)
            self.assertIn(record["data/manifest.json"]["how"], ("hard link", "copy"))

    def test_publish_refused_on_a_glass_disagreement_or_borrowed_node_modules(self):
        from roombuild import publish
        clean = dict(glassScan=dict(disagreements=[], openings={}), tools=dict(relief={"walls": dict(nodeRoot=None)}))
        self.assertEqual(publish.publish_problems(clean), [])
        glass = dict(clean, glassScan=dict(disagreements=["window-front: plane 0 -> 1 changes at v 3.600..3.605 in the scan, 3.52 in the config"]))
        self.assertEqual(len(publish.publish_problems(glass)), 1)
        node = dict(clean, tools=dict(relief={"walls": dict(nodeRoot="C:/elsewhere")}))
        self.assertIn("SURVEYED_ROOMS_NODE_ROOT", publish.publish_problems(node)[0])


class SurveyRecord(unittest.TestCase):
    """build/survey.json, schema version 2: what the web's reader takes (survey-record.ts on the
    web's side holds the contract; publish.record_faults repeats its refusals). The files here are
    stand-ins of a few bytes, each size's file larger than the next size's."""

    @staticmethod
    def staged(config, name):
        """A work directory holding a stand-in for every output and a detail index; (room, work)."""
        from roombuild import publish
        work = os.path.join(T0, name)
        shutil.rmtree(work, ignore_errors=True)
        os.makedirs(os.path.join(work, "proj", "detail"))
        os.makedirs(os.path.join(work, "build"))
        room = Room(config, work)
        outputs = room.survey["outputs"]
        images = outputs["walls"] + outputs.get("ceiling", []) + outputs.get("floor", []) + [f for d in outputs.get("domes", {}).values() for f in d]
        pixels = {f["file"]: f["size"][0] * f["size"][1] for f in images}
        for fname in publish.output_files(room):
            with open(os.path.join(work, "proj", fname), "wb") as f:
                f.write(fname.encode() + b"." * (pixels.get(fname, 0) // 4096))
        with open(os.path.join(work, "proj", "detail", "index.json"), "w", encoding="utf-8") as f:
            json.dump(dict(texelMetres=0.002, tileTexels=512, gutterTexels=8, tiles=3, totalBytes=30), f)
        return room, work

    @staticmethod
    def inside(work, call):
        cwd = os.getcwd()
        os.chdir(work)
        try:
            return call()
        finally:
            os.chdir(cwd)

    def record(self, config, name):
        from roombuild import publish
        room, work = self.staged(config, name)
        return room, work, self.inside(work, lambda: publish.survey_record(room))

    def test_the_saloons_record_is_what_the_reader_takes(self):
        from roombuild import publish, surfaces
        room, work, record = self.record(SALOON, "record-saloon")
        cfg = room.cfg
        self.assertEqual(record["schemaVersion"], 2)
        self.assertEqual(record["room"], dict(name="Saloon", venue="trades-hall", ceilingHeight=5.515, outline=cfg["walls"]["vertices"]))
        self.assertEqual([(w["id"], w["height"], w["kind"]) for w in record["walls"]],
                         [(s["id"], s["height"], s["kind"]) for s in cfg["walls"]["segments"]])
        self.assertEqual(record["atlas"]["files"], ["walls-4096.webp", "walls-2048.webp"])
        self.assertEqual(record["ceiling"]["files"], ["ceiling-1829.webp", "ceiling-915.webp"])
        self.assertEqual(record["floor"]["files"], ["floor-1463.webp", "floor-732.webp"])
        self.assertEqual(record["floor"]["orientation"], "columns planner +x, rows from planner +z")
        self.assertEqual(record["ceiling"]["orientation"], record["floor"]["orientation"])
        # The floor's extent is the rectangle project-floor's texels cover: whole texels from the
        # bounding box's lowest x and highest z.
        pts, w, h, ppm = surfaces.floor_grid(room)
        x0, x1, z0, z1 = room.bbox()
        extent = record["floor"]["extent"]
        self.assertEqual((extent["x"][0], extent["z"][1]), (x0, z1))
        self.assertAlmostEqual(extent["x"][1] - extent["x"][0], w / ppm, places=6)
        self.assertAlmostEqual(extent["z"][1] - extent["z"][0], h / ppm, places=6)
        self.assertLess(max(abs(extent["x"][1] - x1), abs(extent["z"][0] - z0)), 0.5 / ppm + 1e-9)
        self.assertEqual(record["ceiling"]["extent"], dict(x=[x0, x1], z=[z0, z1]))
        # The detail tiles' index is in the detail block; every key of `files` is a plain name.
        index = os.path.join(work, "proj", "detail", "index.json")
        self.assertEqual(record["detail"]["index"], dict(file="index.json", bytes=os.path.getsize(index), sha256=publish.sha256(index)))
        self.assertEqual(sorted(record["files"]), sorted(publish.output_files(room)))
        self.assertTrue(all(publish.FILE_NAME.match(name) for name in record["files"]))
        # Everything version 1 said is still said.
        for key in ("slug", "revision", "captured", "configSha256", "methodRevision", "tools", "linkedInputs", "glassScan", "openings", "relief"):
            self.assertIn(key, record)
        for key in ("size", "ppm", "vRange", "row", "alpha", "alphaFrom", "packing"):
            self.assertIn(key, record["atlas"])
        for key in ("folder", "texelMetres", "tileTexels", "gutterTexels", "tiles", "totalBytes"):
            self.assertIn(key, record["detail"])
        self.assertEqual(record["ceiling"]["relief"]["id"], "ceiling")
        self.assertEqual(publish.record_faults(record), [])
        json.dumps(record)

    def test_walls_follow_the_outline_and_images_their_sizes(self):
        """A reader pairs walls with outline segments by position, so the record's walls are in
        outline order whatever order the atlas was written in; and each photograph's sizes are
        listed largest first whatever order the config gives them in."""
        from roombuild import publish
        room, _, record = self.record(GH, "record-gh")
        self.assertEqual([w["id"] for w in record["walls"]], ["window", "fireplace", "door", "end"])
        self.assertEqual(record["atlas"]["writeOrder"], ["window", "door", "end", "fireplace"])
        self.assertEqual(publish.record_faults(record), [])
        path, _ = variant(SALOON, "saloon-sizes.room.json", lambda r: [r["survey"]["outputs"][k].reverse() for k in ("walls", "ceiling", "floor")])
        _, _, record = self.record(path, "record-sizes")
        self.assertEqual(record["atlas"]["files"], ["walls-4096.webp", "walls-2048.webp"])
        self.assertEqual(record["floor"]["files"], ["floor-1463.webp", "floor-732.webp"])
        self.assertEqual(publish.record_faults(record), [])

    def test_record_faults_are_the_readers_refusals(self):
        import copy
        from roombuild import publish
        _, _, good = self.record(SALOON, "record-faults")
        self.assertEqual(publish.record_faults(good), [])

        def faults(change):
            record = copy.deepcopy(good)
            change(record)
            return " | ".join(publish.record_faults(record))

        self.assertIn("schemaVersion", faults(lambda r: r.__setitem__("schemaVersion", 1)))
        self.assertIn("revision", faults(lambda r: r.__setitem__("revision", 0)))
        self.assertIn("revision", faults(lambda r: r.__setitem__("revision", None)))
        self.assertIn("venue", faults(lambda r: r["room"].__setitem__("venue", "Trades Hall")))
        self.assertIn("clockwise", faults(lambda r: r["room"]["outline"].reverse()))
        self.assertIn("not a plain file name", faults(lambda r: r["files"].__setitem__("detail/index.json", dict(bytes=1, sha256="0" * 64))))
        self.assertIn("missing from files", faults(lambda r: r["files"].pop("floor-732.webp")))
        self.assertIn("missing from files", faults(lambda r: r["files"].pop("ceiling-relief.bin")))
        self.assertIn("largest image first", faults(lambda r: r["atlas"]["files"].reverse()))
        self.assertIn("names no atlas image", faults(lambda r: r["atlas"].__setitem__("files", [])))
        self.assertIn("overlaps", faults(lambda r: r["walls"][1].__setitem__("atlas", list(r["walls"][0]["atlas"]))))
        self.assertIn("leaves the", faults(lambda r: r["walls"][5]["atlas"].__setitem__(0, 4000)))
        self.assertIn("wider than", faults(lambda r: r["walls"][0]["atlas"].__setitem__(2, 1401)))
        self.assertIn("atlas.row", faults(lambda r: r["atlas"].__setitem__("ppm", 100.0)))
        self.assertIn("outline segment 0", faults(lambda r: r["walls"].reverse()))
        self.assertIn("for an outline of 12", faults(lambda r: r["walls"].pop()))
        self.assertIn("relief.order", faults(lambda r: r["relief"]["order"].pop()))
        self.assertIn("used twice", faults(lambda r: r["walls"][1].__setitem__("reliefId", "front")))
        self.assertIn("kind", faults(lambda r: r["walls"][0].__setitem__("kind", "glass")))
        self.assertIn("orientation", faults(lambda r: r["floor"].__setitem__("orientation", "rows from planner -z")))
        self.assertIn("does not increase", faults(lambda r: r["floor"]["extent"]["x"].reverse()))

    def test_an_open_segment_is_recorded_and_named_as_unreadable(self):
        """An open segment has no elevation: the record keeps its place in the outline with no strip
        and no relief id, and says the reader cannot take it (the reader wants both for every segment)."""
        from roombuild import publish
        path, _ = variant(SALOON, "saloon-open.room.json", lambda r: r["walls"]["segments"][2].__setitem__("kind", "open"))
        _, _, record = self.record(path, "record-open")
        self.assertEqual(len(record["walls"]), 12)
        self.assertEqual((record["walls"][2]["kind"], record["walls"][2]["atlas"], record["walls"][2]["reliefId"]), ("open", None, None))
        self.assertNotIn("win-f-ret", record["relief"]["order"])
        faults = publish.record_faults(record)
        self.assertEqual(len(faults), 1, faults)
        self.assertIn("'window-front-return' has no strip in the atlas and no relief", faults[0])

    def test_publishing_copies_the_record_only_for_a_room_that_names_one(self):
        """The Saloon's folder gets survey.json, byte for byte the build's; the Grand Hall's gets its
        nine files and its detail folder and no record, as build.sh leaves it. A record the reader
        would refuse stops the Saloon publishing, with nothing copied."""
        from roombuild import publish
        room, work = self.staged(SALOON, "publish-saloon")
        dest = os.path.join(T0, "published-saloon")
        shutil.rmtree(dest, ignore_errors=True)
        self.inside(work, lambda: publish.publish(room, dest))
        with open(os.path.join(dest, "survey.json"), "rb") as a, open(os.path.join(work, "build", "survey.json"), "rb") as b:
            published = a.read()
            self.assertEqual(published, b.read())
        self.assertNotIn(b"\r", published)
        self.assertEqual(publish.record_faults(json.loads(published)), [])
        self.assertEqual(sorted(os.listdir(dest)), sorted(publish.output_files(room) + ["detail", "survey.json"]))

        room, work = self.staged(GH, "publish-gh-record")
        dest = os.path.join(T0, "published-gh")
        shutil.rmtree(dest, ignore_errors=True)
        self.inside(work, lambda: publish.publish(room, dest))
        self.assertEqual(sorted(os.listdir(dest)), sorted(publish.output_files(room) + ["detail"]))
        self.assertEqual(len(publish.output_files(room)), 9)
        self.assertTrue(os.path.exists(os.path.join(work, "build", "survey.json")))

        path, _ = variant(SALOON, "saloon-revision.room.json", lambda r: r["survey"]["publish"].__setitem__("revision", 0))
        room, work = self.staged(path, "publish-refused")
        dest = os.path.join(T0, "published-refused")
        shutil.rmtree(dest, ignore_errors=True)
        with self.assertRaises(SystemExit) as refused:
            self.inside(work, lambda: publish.publish(room, dest))
        self.assertIn("survey.json: revision is 0", str(refused.exception))
        self.assertFalse(os.path.exists(dest))


class OneBlasThread(unittest.TestCase):
    """The labels' band threads each call BLAS, and BLAS threads of its own under them deadlocked: every
    entry point holds BLAS to one thread for that step, before numpy loads."""
    NAMES = ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")

    @staticmethod
    def source(*parts):
        with open(os.path.join(ROOMS, *parts), encoding="utf-8") as f:
            return f.read()

    def test_the_step_runner_sets_it_for_labels_before_numpy_loads(self):
        path = os.path.join(ROOMS, "roombuild", "step.py")
        spec = importlib.util.spec_from_file_location("roombuild_step", path)
        step = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(step)
        env = {"OPENBLAS_NUM_THREADS": "4"}
        self.assertEqual(step.hold_blas("labels", env), {n: "1" for n in self.NAMES})
        self.assertEqual(env, {n: "1" for n in self.NAMES})
        env = {"OPENBLAS_NUM_THREADS": "4"}
        self.assertEqual(step.hold_blas("atlas", env), {})
        self.assertEqual(env, {"OPENBLAS_NUM_THREADS": "4"})
        src = self.source("roombuild", "step.py")
        self.assertLess(src.index("hold_blas(sys.argv[1])"), src.index("from roombuild import"))

    def test_the_old_script_its_build_and_its_test_runner_set_it_too(self):
        script = self.source("..", "grand-hall-survey", "label-views.py")
        self.assertLess(script.index("os.environ[_name] = '1'"), script.index("import numpy"))
        build_sh = self.source("..", "grand-hall-survey", "build.sh")
        self.assertIn('OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 python3 "$SURVEY/label-views.py"', build_sh)
        runner = self.source("tests", "run_old.py")
        self.assertLess(runner.index('os.environ[name] = "1"'), runner.index("import project"))


class SubCommands(unittest.TestCase):
    """--list, --only and --resume: a caller can run one sub-command at a time (taking whatever
    lock it must round each), and a stopped build picks up where it left off."""

    def work(self, name):
        work = os.path.join(T0, name)
        shutil.rmtree(work, ignore_errors=True)
        os.makedirs(os.path.join(work, "proj"))
        os.makedirs(os.path.join(work, "build"))
        return work

    @staticmethod
    def writes(rel, text):
        return [sys.executable, "-c", f"open({rel!r}, 'a').write({text!r})"]

    def subs(self):
        """A four-step build of small files: b's two sub-commands stand apart from each other, c reads both."""
        return [dict(id="a:1", step="a", argv=self.writes("proj/a.txt", "a"), apart=False),
                dict(id="b:1", step="b", argv=self.writes("proj/b1.txt", "b"), apart=True),
                dict(id="b:2", step="b", argv=self.writes("proj/b2.txt", "b"), apart=True),
                dict(id="c:1", step="c", argv=self.writes("proj/c.txt", "c"), apart=False),
                dict(id="publish:1", step="publish", argv=None, apart=False)]

    def test_list_names_every_sub_command_and_writes_nothing(self):
        work = os.path.join(T0, "list-gh")
        shutil.rmtree(work, ignore_errors=True)
        r = py("build-room.py", GH, work, "--list")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rows = dict(line.split(None, 1) for line in r.stdout.splitlines())
        self.assertEqual(rows["inputs:2"].split()[1], os.path.join("..", "grand-hall-survey", "dump-mesh.mjs"))
        self.assertEqual(rows["labels:3"], os.path.join("roombuild", "step.py") + " labels end")
        self.assertEqual(rows["walls:5"], os.path.join("roombuild", "step.py") + " canvases end")
        self.assertEqual(rows["detail:5"], os.path.join("roombuild", "step.py") + " pack-detail")
        self.assertIn("publish:1", rows)
        self.assertEqual(len(rows), 32)
        self.assertFalse(os.path.exists(work), "--list wrote files")
        drv = load_driver()
        self.assertEqual([s["id"] for s in drv.sub_commands(Room(GH, T0))], list(rows))
        saloon = [s["id"] for s in drv.sub_commands(Room(SALOON, T0))]
        self.assertEqual(sum(1 for i in saloon if i.startswith("labels:")), 12)
        self.assertEqual(len(saloon), len(set(saloon)))

    def test_only_refuses_an_unknown_id_and_a_span(self):
        work = os.path.join(T0, "only-gh")
        shutil.rmtree(work, ignore_errors=True)
        for args, want in ((("--only", "labels:9"), "no such sub-command"), (("--only", "labels:1", "--from", "labels"), "leave --from and --to out")):
            r = py("build-room.py", GH, work, *args)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn(want, r.stdout + r.stderr)
            self.assertFalse(os.path.exists(work), "the refusal wrote files")

    def test_one_sub_command_runs_alone_and_is_recorded(self):
        drv = load_driver()
        work, subs = self.work("only"), self.subs()
        rec = drv.Recorder(work)
        prepared = []
        ran, skipped = drv.run_subs(rec, subs, [subs[2]], "cfg", prepare=prepared.append)
        self.assertEqual((ran, skipped, prepared), (["b:2"], [], ["b"]))
        self.assertEqual(sorted(os.listdir(os.path.join(work, "proj"))), ["b2.txt"])
        with open(os.path.join(work, "build", "steps.json"), encoding="utf-8") as f:
            (row,) = json.load(f)
        self.assertEqual((row["id"], row["step"], row["exit"], row["config"], list(row["outputs"])), ("b:2", "b", 0, "cfg", ["proj/b2.txt"]))
        self.assertEqual(row["outputs"]["proj/b2.txt"]["bytes"], 1)

    def test_resume_skips_what_is_done_and_reruns_what_is_stale(self):
        drv = load_driver()
        work, subs = self.work("resume"), self.subs()
        published = []
        run = lambda selected=None, config="cfg": drv.run_subs(drv.Recorder(work), subs, selected or subs, config, resume=True,  # noqa: E731
                                                                 publish=lambda: published.append(1))
        self.assertEqual(run(subs[:2]), (["a:1", "b:1"], []))                    # a build stopped after b:1
        self.assertEqual(run(), (["b:2", "c:1", "publish:1"], ["a:1", "b:1"]))    # picks up at b:2
        self.assertEqual(run(), (["publish:1"], ["a:1", "b:1", "b:2", "c:1"]))    # nothing left but the record
        self.assertEqual(len(published), 2)
        with open(os.path.join(work, "proj", "b1.txt"), "a") as f:                # a file changed under a finished sub-command
            f.write("x")
        self.assertEqual(run(), (["b:1", "c:1", "publish:1"], ["a:1", "b:2"]))    # it runs again, and what reads it; b:2 stands apart
        os.remove(os.path.join(work, "proj", "a.txt"))                            # an earlier step's file is gone
        self.assertEqual(run()[0], ["a:1", "b:1", "b:2", "c:1", "publish:1"])     # everything after it is stale
        self.assertEqual(run()[1], ["a:1", "b:1", "b:2", "c:1"])
        self.assertEqual(run(config="other")[0], ["a:1", "b:1", "b:2", "c:1", "publish:1"])   # another config: nothing is taken on trust
        rec = drv.Recorder(work)
        self.assertEqual(drv.fresh(rec, subs, 3, "cfg"), (False, "the config changed since it ran"))
        changed = [dict(s, argv=s["argv"] + ["x"]) if s["id"] == "c:1" else s for s in subs]
        self.assertEqual(drv.fresh(rec, changed, 3, "other"), (False, "its command changed"))

    def test_a_failed_sub_command_stops_the_build_and_runs_again(self):
        drv = load_driver()
        work, subs = self.work("failed"), self.subs()
        subs[1] = dict(subs[1], argv=[sys.executable, "-c", "import os, sys; sys.exit(0 if os.path.exists('proj/ok') else 3)"])
        with self.assertRaises(SystemExit) as caught:
            drv.run_subs(drv.Recorder(work), subs, subs, "cfg", resume=True)
        self.assertIn("b:1 failed (exit 3)", str(caught.exception))
        open(os.path.join(work, "proj", "ok"), "w").close()
        ran, skipped = drv.run_subs(drv.Recorder(work), subs, subs, "cfg", resume=True)
        self.assertEqual((ran, skipped), (["b:1", "b:2", "c:1", "publish:1"], ["a:1"]))


if __name__ == "__main__":
    unittest.main()
