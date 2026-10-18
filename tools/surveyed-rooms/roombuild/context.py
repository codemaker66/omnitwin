"""A room config as the survey build reads it: walls, tiles, stations, occluders, edits, and the
gates that open code paths the Grand Hall never used.

Every room fact the build needs comes from here. Method constants (tolerances, fill passes,
encodings) stay in the step modules, as in tools/grand-hall-survey.
"""
import hashlib
import json
import os

import numpy as np

import roomlib

# Gates: code paths the Grand Hall never opens. For grand-hall.room.json the ledger is empty.
GATES = {
    "B4": "wall not axis-aligned in E57: depth by dot product, fins moved along the normal",
    "B5": "wall shorter than 2 x 0.55 m: no corner fin search",
    "B6": "reflex corner: no fin search at that end",
    "B7": "method revision 2: corner statistics ignore openings",
    "B8": "wall shorter than 2.0 m: corner intrusions take reference 0",
    "B9": "reflex corner: no intrusion clearing at that end",
    "B10": "glazing other than clear: glass mask from the measured outline and planes",
    "B11": "segmental head in the clear colour test",
    "B14": "no atlas placement: strips packed on shelves",
    "B16": "ceiling relief from the view up at the ceiling",
    "B17": "floor refills skipped: no refill.shift",
    "B18": "outline not a rectangle: floor texels outside it masked",
    "B19": "boards run along z: refills roll along rows",
    "B20": "patch copied from another wall",
    "B21": "test-only depth-map size (SURVEYED_ROOMS_TEST_DEPTH_SIZE)",
    "B22": "node modules from another checkout (SURVEYED_ROOMS_NODE_ROOT): its meshoptimizer meshes the relief",
}
NODE_ENV = "SURVEYED_ROOMS_NODE_ROOT"
FIN_REF_END = 0.55          # fix-corners.py REF[1]: a wall needs 2 x this for its fin search
INTRUSION_REACH = 2.0       # wall-depth.py: a wall shorter than this has no clean "beyond" band
GEOMETRIC_GLAZING = ("stained-backlit", "frosted-lower", "sheer")
SUPPORTED_DOME_PROFILES = ("cap-on-elliptic-band",)


class BuildRefused(Exception):
    """The config asks for something this stage of the build cannot do."""


def _to_e57_np(k):
    """Planner (x, z) -> E57 offsets (dX, dY) on arrays: roomlib's quarter-turn table."""
    return {
        0: lambda x, z: (x, -z),
        1: lambda x, z: (-z, -x),
        2: lambda x, z: (-x, z),
        3: lambda x, z: (z, x),
    }[k]


class Room:
    def __init__(self, path, work=None):
        with open(path, "rb") as f:
            # LF whatever the checkout's line endings, so configSha256 names the content, not the
            # platform (a CRLF only ever ends a line in JSON text).
            self.raw = f.read().replace(b"\r\n", b"\n")
        self.path = os.path.abspath(path)
        self.sha256 = hashlib.sha256(self.raw).hexdigest()
        self.cfg = json.loads(self.raw.decode("utf-8"))
        self.work = os.path.abspath(work) if work else os.getcwd()
        cfg = self.cfg
        self.survey = cfg["survey"]
        self.revision = self.survey.get("methodRevision", 1)
        self.turns = cfg["transform"]["quarterTurns"]
        self.walls = roomlib.walls(cfg)
        self.wmap = {w["id"]: w for w in self.walls}
        self.by_name = {w["name"]: w for w in self.walls}
        self.openings = {o["id"]: o for o in cfg["openings"]}
        self.convex = roomlib.corner_convex(cfg)
        wv = self.survey["wallViews"]
        order = wv.get("order") or [s["id"] for s in cfg["walls"]["segments"]]
        self.order = [self.wmap[i] for i in order if self.wmap[i]["segment"]["kind"] != "open"]
        self.lod = cfg["source"]["panoramas"]["size"]
        self._views = None
        self._stations = None

    # --- geometry -------------------------------------------------------------------------
    def to_e57_np(self, x, z):
        return _to_e57_np(self.turns)(x, z)

    def bbox(self):
        return roomlib.bounding_box(self.cfg)

    def is_rectangle(self):
        v = self.cfg["walls"]["vertices"]
        if len(v) != 4:
            return False
        xs, zs = {p[0] for p in v}, {p[1] for p in v}
        return len(xs) == 2 and len(zs) == 2

    def ends_reflex(self, w):
        """(left, right): whether the wall's u = 0 end (vertex i + 1) and u = length end
        (vertex i) are reflex corners."""
        i, n = w["index"], len(self.convex)
        return (not self.convex[(i + 1) % n], not self.convex[i])

    def aligned(self, w):
        """(axis, plane, sign) for a wall whose E57 normal is an axis, else None. plane and sign
        are Python floats, as fix-corners.py's PLANES are (numpy keeps float32 arithmetic)."""
        nX, nY = w["normalE57"]
        if abs(nX) == 1.0 and nY == 0:
            axis = 0
        elif abs(nY) == 1.0 and nX == 0:
            axis = 1
        else:
            return None
        return axis, float(w["cornerE57"][axis]), float(w["normalE57"][axis])

    def depth(self, w, P):
        """Depth in front of (+) the wall's face at positions P (..., >= 3), as the old scripts
        compute it: (P[..., axis] - plane) * sign for an axis-aligned wall."""
        a = self.aligned(w)
        if a is not None:
            axis, plane, sign = a
            return (P[..., axis] - plane) * sign
        cX, cY = w["cornerE57"]
        nX, nY = w["normalE57"]
        return (P[..., 0] - cX) * nX + (P[..., 1] - cY) * nY

    def normal3(self, w):
        """The wall's inward normal as a (1, 3) float array, with no -0.0."""
        nX, nY = w["normalE57"]
        return np.array([[nX + 0.0, nY + 0.0, 0.0]])

    # --- survey files ------------------------------------------------------------------------
    def views(self):
        if self._views is None:
            with open(os.path.join(self.work, "views", "views-walls.json"), encoding="utf-8") as f:
                self._views = json.load(f)
        return self._views

    def tiles(self, w):
        """The wall's elevation tiles in the views file's order."""
        return [v for v in self.views() if v["wall"] == w["name"]]

    def ceiling_view(self):
        with open(os.path.join(self.work, "views", "views-ceiling.json"), encoding="utf-8") as f:
            return json.load(f)[0]

    def station_ids(self):
        return [s["id"] for s in self.cfg["stations"]]

    def stations(self, manifest_path=None):
        """The room's stations as project.stations() builds them, in the manifest's order
        (data/manifest.json in the work directory unless a manifest is named)."""
        if manifest_path is not None:
            self._stations = None
        if self._stations is None:
            with open(manifest_path or os.path.join(self.work, "data", "manifest.json"), encoding="utf-8") as f:
                m = json.load(f)
            wanted = set(self.station_ids())
            out = []
            for n in m["nodes"]:
                if n["id"] in wanted:
                    g = n["exposure"]["gain"]
                    wb = n["exposure"]["wb"]
                    out.append(dict(id=n["id"], t=np.array(n["pose"]["t"], float), gain=np.array([g * wb[0], g * wb[1], g * wb[2]])))
            self._stations = out
        return self._stations

    def occluder_tuples(self):
        return [((o["centreE57"][0], o["centreE57"][1]), o["radius"], (o["zE57"][0], o["zE57"][1])) for o in self.cfg["occluders"]]

    def projection(self, surface):
        """project()'s keyword arguments for a surface."""
        p = self.survey["projection"][surface]
        kw = dict(lod=self.lod)
        for key, arg in (("cosMin", "cos_min"), ("pCos", "p_cos"), ("qDist", "q_dist"), ("maxDist", "max_dist"),
                         ("nadir", "nadir"), ("glare", "glare")):
            if key in p:
                kw[arg] = p[key]
        return kw

    # --- openings and edits --------------------------------------------------------------------
    def openings_on(self, w):
        return [o for o in self.cfg["openings"] if o["wall"] == w["id"]]

    def opening_centre(self, o):
        return roomlib.opening_centre(self.cfg, o, self.wmap)

    def patches(self, applies):
        """Patch edits that apply to `applies` ('photo' or 'relief'), resolved, in config order:
        (wall, u0, u1, v0, v1, mode, arg) with arg = shift, mirror axis, or for a copy
        (source wall, source u0, mirror)."""
        out = []
        for e in self.cfg["edits"]:
            if e["type"] != "patch" or applies not in e["applies"]:
                continue
            u0, u1 = (roomlib.resolve_u(self.cfg, r, self.openings, self.wmap) for r in e["u"])
            if e["mode"] == "shift":
                arg = roomlib.resolve_shift(self.cfg, e["by"], self.openings, self.wmap)
            elif e["mode"] == "mirror":
                arg = e["about"]
            else:
                src = e["from"]
                arg = (self.wmap[src["wall"]], src["u"], bool(src.get("mirror", False)))
            out.append((self.wmap[e["wall"]], u0, u1, e["v"][0], e["v"][1], e["mode"], arg))
        return out

    def recesses(self, applies):
        out = []
        for e in self.cfg["edits"]:
            if e["type"] == "recess" and applies in e["applies"]:
                u0, u1 = (roomlib.resolve_u(self.cfg, r, self.openings, self.wmap) for r in e["u"])
                out.append((self.wmap[e["wall"]], u0, u1, e["v"][0], e["v"][1], e["depth"]))
        return out

    def floor_refills(self):
        return [e for e in self.cfg["edits"] if e["type"] == "floor-refill"]

    def relief_id(self, w):
        return w["segment"].get("survey", {}).get("reliefId", w["id"])

    def relief_order(self):
        order = self.survey.get("relief", {}).get("order")
        return [self.wmap[i] for i in order] if order else list(self.order)

    def glazed_walls(self):
        """Walls with a window whose glazing the build reads (anything but none)."""
        return [w for w in self.order if any(o["kind"] == "window" and o["glazing"] != "none" for o in self.openings_on(w))]

    # --- gates ---------------------------------------------------------------------------------
    def ledger(self):
        """Every gate this config opens, before any work is done."""
        rows = []

        def add(gate, where, note=""):
            rows.append(dict(gate=gate, what=GATES[gate], where=where, note=note))

        for w in self.order:
            if self.aligned(w) is None:
                add("B4", f"wall {w['id']}")
            if w["length"] < 2 * FIN_REF_END:
                add("B5", f"wall {w['id']}", f"{w['length']:.3f} m")
            if w["length"] < INTRUSION_REACH:
                add("B8", f"wall {w['id']}", f"{w['length']:.3f} m")
            left, right = self.ends_reflex(w)
            for end, reflex in (("left", left), ("right", right)):
                if reflex:
                    add("B6", f"wall {w['id']} {end} end")
                    add("B9", f"wall {w['id']} {end} end")
        if self.revision >= 2:
            add("B7", "room", f"methodRevision {self.revision}")
        for o in self.cfg["openings"]:
            if o["kind"] != "window" or o["glazing"] == "none":
                continue
            if o["glazing"] in GEOMETRIC_GLAZING:
                add("B10", f"opening {o['id']}", o["glazing"])
            elif o["headShape"] == "segmental":
                add("B11", f"opening {o['id']}")
        atlas = self.survey.get("atlas", {})
        if "placement" not in atlas:
            add("B14", "atlas")
        if "ceilingRelief" in self.survey:
            add("B16", "ceiling")
        refill = self.survey.get("floorPhoto", {}).get("refill", {})
        if "floorPhoto" in self.survey and "shift" not in refill:
            add("B17", "floor", "the boards' repeat along their run is not measured")
        if not self.is_rectangle():
            add("B18", "floor")
        if self.cfg["floor"].get("boardsRun", "x") == "z" and "shift" in refill:
            add("B19", "floor")
        for e in self.cfg["edits"]:
            if e["type"] == "patch" and e["mode"] == "copy":
                add("B20", f"wall {e['wall']}", f"from {e['from']['wall']}")
        if os.environ.get("SURVEYED_ROOMS_TEST_DEPTH_SIZE"):
            add("B21", "projection", os.environ["SURVEYED_ROOMS_TEST_DEPTH_SIZE"])
        if os.environ.get(NODE_ENV):
            add("B22", "relief", os.environ[NODE_ENV])
        return rows

    # --- build checks beyond check_room ----------------------------------------------------------
    def build_problems(self):
        """What this stage of the build cannot do with the config (each refuses the build)."""
        cfg, survey, out = self.cfg, self.survey, []
        if cfg["source"]["kind"] != "matterport-e57-twin":
            out.append(f"source.kind {cfg['source']['kind']}: only the Matterport E57 twin is supported")
        if cfg["source"].get("panoramas", {}).get("size") != 8192:
            out.append("source.panoramas.size must be 8192 (project.load_pano reads data/pano8k/<id>_8192.webp)")
        if any("sagitta" in s for s in cfg["walls"]["segments"]):
            out.append("a curved wall (sagitta) is not supported yet")
        if cfg["freeStanding"]:
            out.append("free-standing elements are not supported yet")
        if len(cfg["floor"]["levels"]) > 1:
            out.append("more than one floor level is not supported yet")
        for d in cfg["ceiling"].get("domes", []):
            if d["profile"] not in SUPPORTED_DOME_PROFILES:
                out.append(f"dome {d['id']}: profile {d['profile']} is not supported")
        for name in ("walls", "ceiling"):
            if name not in survey.get("projection", {}):
                out.append(f"survey.projection.{name} is missing")
        if cfg["ceiling"].get("domes") and "dome" not in survey.get("projection", {}):
            out.append("survey.projection.dome is missing")
        if cfg["ceiling"].get("domes") and "domePhoto" not in survey:
            out.append("survey.domePhoto is missing")
        for name in ("floorPhoto", "atlas", "relief", "outputs", "publish", "ceilingView"):
            if name not in survey:
                out.append(f"survey.{name} is missing")
        if "floorPhoto" in survey and "floor" not in survey.get("projection", {}):
            out.append("survey.projection.floor is missing")
        if "relief" in survey:
            rel = survey["relief"]
            if rel.get("ppm") != survey["wallViews"]["ppm"] / 2:
                out.append(f"survey.relief.ppm {rel.get('ppm')} must be half the wall views' {survey['wallViews']['ppm']} (2 x 2 mean)")
            for key in ("vRange", "depthRange", "simplifyError", "holdFloor", "holdCeiling"):
                if key not in rel:
                    out.append(f"survey.relief.{key} is missing")
        for w in self.walls:
            rid = self.relief_id(w)
            if len(rid.encode("utf-8")) > 12 or not rid.isascii():
                out.append(f"wall {w['id']}: GHR1 id {rid!r} is longer than 12 ASCII bytes")
        for o in cfg["openings"]:
            if o["kind"] == "window" and o["glazing"] in GEOMETRIC_GLAZING and not o.get("glass", {}).get("planes"):
                out.append(f"opening {o['id']}: {o['glazing']} glazing needs glass.planes")
            if "glass" in o and not (o["kind"] == "window" and o["glazing"] in GEOMETRIC_GLAZING):
                out.append(f"opening {o['id']}: its glass block is read only for {', '.join(GEOMETRIC_GLAZING)} windows; "
                           f"{o['kind']} with glazing {o['glazing']} would ignore it (clear glass takes the colour test)")
        for i, e in enumerate(cfg["edits"]):
            if e["type"] == "recess" and "photo" in e["applies"]:
                out.append(f"edit {i} (recess on {e['wall']}): a recess changes the relief only; drop 'photo' from applies")
        outputs = survey.get("outputs", {})
        if outputs:
            domes = {d["id"] for d in cfg["ceiling"].get("domes", [])}
            if set(outputs.get("domes", {})) != domes:
                out.append(f"survey.outputs.domes {sorted(outputs.get('domes', {}))} must name every dome {sorted(domes)}")
            if "ceilingRelief" in survey and not outputs.get("ceilingRelief"):
                out.append("survey.outputs.ceilingRelief is missing")
            if not outputs.get("relief"):
                out.append("survey.outputs.relief is missing")
        return out
