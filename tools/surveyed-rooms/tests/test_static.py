"""T0: the proofs that need no build (seconds).

- prove-build-identity.py --static on the Grand Hall: every config-derived table equals the old
  scripts' literals; and it notices a changed value.
- prove-grand-hall.py still PROVED after the roomlib and survey.outputs changes.
- build-room.py --plan: the Grand Hall opens no gate; the Saloon opens exactly the expected ones;
  --expect-legacy refuses the Saloon; a config missing survey blocks is refused by name.
- check_room.py's new checks fire (relief ids, view depth, glass outline, outputs, occluders).
- the prover's self-test (including a linked depth map reported as linked, not identical).
- the driver's refusals before anything is written (a restart from windows or corners with clear
  glazing, --reuse-depth without --inputs-from, --publish with another checkout's node modules),
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
        self.assertEqual(gates, Counter({"B5": 4, "B8": 4, "B6": 8, "B9": 8, "B7": 1, "B10": 3, "B14": 1, "B16": 1, "B17": 1, "B18": 1}))
        self.assertIn("atlas 4096 x 2304, strips 1111 high", r.stdout)
        for wall in ("window-front-return", "window-rear-return", "fireplace-rear-return", "fireplace-front-return"):
            self.assertRegex(r.stdout, rf"B5 +wall {wall} ")

    def test_expect_legacy_refuses_the_saloon(self):
        r = py("build-room.py", SALOON, os.path.join(T0, "legacy-saloon"), "--to", "check", "--expect-legacy")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--expect-legacy, but the config opens gate B5", r.stdout + r.stderr)

    def test_missing_survey_blocks_are_named(self):
        def strip(room):
            for key in ("relief", "outputs", "floorPhoto", "ceilingRelief"):
                room["survey"].pop(key)
        path, _ = variant(SALOON, "saloon-unready.room.json", strip)
        r = py("build-room.py", path, os.path.join(T0, "plan-unready"), "--plan")
        self.assertEqual(r.returncode, 1)
        for name in ("survey.relief is missing", "survey.outputs is missing", "survey.floorPhoto is missing"):
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

    def test_restart_from_windows_or_corners_with_clear_glazing(self):
        for step in ("windows", "corners"):
            work = self.fresh(f"restart-{step}")
            r = py("build-room.py", GH, work, "--from", step)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("the clear glass test reads proj/wall-*.npz", r.stdout + r.stderr)
            self.assertFalse(os.path.exists(work), "the refusal wrote files")

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


if __name__ == "__main__":
    unittest.main()
