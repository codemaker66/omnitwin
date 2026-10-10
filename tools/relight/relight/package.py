"""The relight package (docs/engineering/relight-package.md, venviewer.relight.v1): written from the tiles' records and
exact, hash-checked work artifacts, and read back from disk for the checks (R1a Task 5 Steps 6 and 7).

Only exact files are packaged (the owner's rule, 7 October): each work artifact is read by its exact name and only when
its SHA-256 and size equal the ones its passing evidence records (Task 4c). Every path the manifest names is built with
'/', every gzip has mtime 0 and the manifest carries no wall-clock value (its tool and createdAt name the commit that
built it), so a second write at the same commit is byte-identical. A write replaces the package folder whole, so the
folder never mixes two writes' files."""
from __future__ import annotations

import gzip, hashlib, io, json, math, os, posixpath, shutil
from dataclasses import dataclass

import numpy as np

from . import codec, reference, sunbounce
from . import windows as W

SCHEMA = "venviewer.relight.v1"
DUMP = {"indent": 1, "sort_keys": True, "allow_nan": False}   # the manifest's json.dumps arguments (a NaN fails the build)
CHECK_KEYS = ("capturedIdentity", "proofRegression", "transfer", "determinism", "skyBounceCheck", "wallFaceRate")
WINDOW_IDS = ("W1", "W2", "W3", "W4", "W5")
K_MAX = 192                     # __main__.SUN_KMAX, the most basis volumes the K search tries (R1b's schema accepts up to it)
SUBSAMPLES = 16                 # sunbounce.OFFSETS: the 4 x 4 rays of each patch
LAMPS = (("cove", 5, "led-tape"), ("ch_end", 6, "candle-unconfirmed"), ("ch_centre", 7, "candle-unconfirmed"),
         ("dome", 8, "led-spot"))  # group, record source, the installer's type (information only)
SKIN_GROUPS = ("door", "window", "end_xmin", "end_xmax", "ceiling")
PROBES_FILE, PROBE_VALID_FILE = "probes.bin.gz", "probe-valid.bin.gz"
SKY_FILES = {"basis": "sky/basis.bin.gz", "valid": "sky/basis-valid.bin.gz", "table": "sky/coefficients.bin.gz",
             "rays": "sky/patch-rays.bin.gz", "normals": "sky/patch-normals.bin.gz", "areas": "sky/patch-areas.bin.gz"}
FLOOR_FILES = ("floor/light-0.png", "floor/light-1.png", "floor/light-2.png")
FLOOR_SKIN = "floor-skin/v2"
# sun-bounce.npz's arrays the package carries, with their dtypes (needed, real and nodePower are bake diagnostics)
SKY_ARRAYS = {"basis": np.float16, "valid": np.bool_, "coeffs": np.float32, "patchRays": np.float32,
              "patchNormal": np.float32, "patchArea": np.float32, "floorMean": np.float32}
SKY_FRAME = ("azimuth0", "elevation0", "step", "gridOrigin", "gridShape", "gridSpacing")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def gz(data: bytes) -> bytes:
    """The package's gzip: level 9, mtime 0 (deterministic bytes)."""
    return gzip.compress(data, compresslevel=9, mtime=0)


def dump_manifest(manifest: dict) -> bytes:
    return json.dumps(manifest, **DUMP).encode("utf-8")


def tile_file(name: str) -> str:
    """tiles/<tile stem>.relight.gz"""
    return posixpath.join("tiles", posixpath.splitext(name)[0] + ".relight.gz")


def window_file(wid: str) -> str:
    return posixpath.join("windows", f"{wid}.alpha.gz")


# ------------------------------------------------------------------------------------------- exact, hash-checked inputs
def verified(work, evidence, name, evidence_name):
    """The exact work artifact `name`, refused unless its evidence JSON passed and records this file's SHA-256 (Task 4c)."""
    import hashlib, json, os
    path = os.path.join(work, name)
    with open(os.path.join(evidence, evidence_name), encoding="utf-8") as f:
        ev = json.load(f)
    record = ev.get("artifact")
    if ev.get("pass") is False or not record:
        raise ValueError(f"{evidence_name} records no passing artifact for {name}")
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    if h.hexdigest() != record["sha256"] or os.path.getsize(path) != record["bytes"]:
        raise ValueError(f"{path} is not the artifact {evidence_name} records ({record['sha256']})")
    return path, record["sha256"]


def verified_copies(work, evidence, names) -> tuple[dict, dict]:
    """Work files Task 4b's promote copied in ({name: sha256}, refit.json), each refused unless <evidence>/refit.json
    passed and its `copied` records this file's SHA-256 (a refused promote copies nothing and records none)."""
    with open(os.path.join(evidence, "refit.json"), encoding="utf-8") as f:
        refit = json.load(f)
    copied = refit.get("copied") or {}
    if refit.get("pass") is not True or not copied:
        raise ValueError("refit.json records no passing promote: the refit's files are not verified")
    hashes = {}
    for name in names:
        got = sha256_file(os.path.join(work, name))
        if copied.get(name) != got:
            raise ValueError(f"{os.path.join(work, name)} is not the file refit.json's promote copied ({copied.get(name)})")
        hashes[name] = got
    return hashes, refit


def verified_fit(work, evidence) -> tuple[dict, dict, dict]:
    """fit.json and fit_state.npz as Task 4b promoted them (verified_copies), and fit.json the refit (model name
    `refit`): the bake never packages the proof fit. Returns (fit, {name: sha256}, refit.json)."""
    hashes, refit = verified_copies(work, evidence, ("fit.json", "fit_state.npz"))
    with open(os.path.join(work, "fit.json"), "rb") as f:
        data = f.read()
    if sha256_bytes(data) != hashes["fit.json"]:
        raise ValueError("fit.json changed while it was read")
    fit = json.loads(data)
    if (fit.get("model") or {}).get("name") != "refit":
        raise ValueError("fit.json is not the refit (its model name is not refit): the bake never packages the proof fit")
    return fit, hashes, refit


# ------------------------------------------------------------------------------------------------------ manifest parts
def capture_of(fit: dict) -> dict:
    """The manifest's `capture` from the refit's fit.json: weights and colours picked by name in the records' source
    order (the fit's sun_cap left out by name, never by position), the daylight colour W1's (refused with a channel
    under 1e-6, the kernel's rBack guard, which would make the captured setting not neutral), and gamma written as
    exactly 1 once the fit's is within 1e-6 of 1 (the kernel has no gamma term; R1b refuses any other)."""
    names = list(fit["bases"])
    missing = [s for s in codec.SOURCES if s not in names]
    if missing:
        raise ValueError(f"fit.json has no {missing}")
    pick = [names.index(s) for s in codec.SOURCES]
    gamma = float(fit["gamma"])
    if not abs(gamma - 1.0) <= 1e-6:
        raise ValueError(f"the fitted gamma {gamma} is not within 1e-6 of 1: the relight kernel has no gamma term")
    colours = [[float(c) for c in fit["colours"][i]] for i in pick]
    daylight = colours[codec.SOURCES.index("W1")]
    if not all(c >= 1e-6 for c in daylight):
        raise ValueError(f"the daylight colour {daylight} has a channel under 1e-6: the kernel's rBack = skyColour / "
                         f"max(daylight, 1e-6) would not be 1 at the captured light")
    return {"weights": [float(fit["weights"][i]) for i in pick], "colours": colours,
            "daylightColour": list(colours[codec.SOURCES.index("W1")]),
            "skyBandWeights": [float(v) for v in fit["sky_weights_capture"]], "gamma": 1}


def lamps_of(capture: dict, measured_ratio, refit: dict) -> dict:
    """The manifest's `lamps`: per group its record source, its colour at full level (capture.colours[source] /
    capture.daylightColour, divided in float64 from the very floats written to `capture`) and the installer's type; the
    measured lamp/daylight ratio; and the refit's per-bulb intensity, lamp ratio, crown-tube weight and bulb table."""
    groups = {}
    for name, source, kind in LAMPS:
        if codec.SOURCES[source] != name:
            raise ValueError(f"record source {source} is {codec.SOURCES[source]}, not {name}")
        groups[name] = {"source": source, "type": kind,
                        "colour": [capture["colours"][source][c] / capture["daylightColour"][c] for c in range(3)]}
    accept, bulbs = refit["gates"]["accept"], refit["bulbs"]
    return {"groups": groups, "measuredRatio": [float(v) for v in measured_ratio],
            "refit": {"perBulbIntensity": math.exp(float(accept["logPerBulb"])), "lampRatio": float(accept["lampRatio"]),
                      "wCrown": float(bulbs["wCrown"]), "bulbTableSha256": str(bulbs["sha256"])}}


def sun_check_summary(sun_check: dict) -> dict:
    """evidence.sunCheck: sun-check.json's pass, threshold and per direction the IoU and mean |dT| on both point sets."""
    rows = [{"utc": d["utc"], "az": d["az"], "el": d["el"],
             **{k: {"iou": d[k]["iou"], "meanAbsDiff": d[k]["meanAbsDiff"]} for k in ("floor", "splats")}}
            for d in sun_check["directions"]]
    return {"pass": sun_check["pass"], "threshold": sun_check["threshold"], "directions": rows}


def sky_bounce_summary(sky_check: dict) -> dict:
    """evidence.skyBounce: sun-bounce-check.json's K, its rule, the selection, check and strict draws' worst bright
    direction and pooled median, and pass."""
    def draw(result):
        return {"worstBright": result["worstBright"], "pooledMedian": result["pooledMedian"]}
    return {"K": sky_check["K"], "kRule": sky_check["kRule"], "pass": sky_check["pass"], "selection": draw(sky_check["result"]),
            "check": draw(sky_check["independentCheck"]["result"]), "strict": draw(sky_check["strictCheck"]["result"])}


def refit_summary(refit: dict) -> dict:
    """evidence.refit: refit.json's gates: the residual (data-cost) ratio, the lamp ratio, the night photographs' metrics,
    the crown tubes' sensitivity and the range-aware balance."""
    g = refit["gates"]
    accept, sensitivity = g["accept"], g["sensitivity"]
    return {"pass": refit["pass"], "residualRatio": accept["residualRatio"], "lampRatio": accept["lampRatio"],
            "dataCost": {"proof": accept["dataCostProof"], "refit": accept["dataCostRefit"]},
            "photo": {"pass": g["photo-gate"]["pass"], "views": g["photo-gate"]["views"]},
            "crownSensitivity": {"pass": sensitivity["pass"], "preferredEnd": sensitivity["preferredEnd"],
                                 "runs": {tag: {k: run[k] for k in ("wCrown", "dataCost", "chCentreShare", "photo")}
                                          for tag, run in sensitivity["runs"].items()}},
            "rangeBalance": {k: g["range-balance"][k] for k in ("balance", "limit", "pass")}}


def floor_maps(D, ranges) -> list[bytes]:
    """The three floor light PNGs: RGBA8 log codes of D (h, w, 9) with the nine floor ranges, source k in map k // 4,
    channel k % 4 (light-0: W1..W4, light-1: W5, cove, ch_end, ch_centre, light-2: dome, then three zero channels); row
    0 is D's row 0, the first PNG row."""
    from PIL import Image
    D = np.asarray(D)
    h, w, n = D.shape
    codes = np.zeros((h, w, 4 * len(FLOOR_FILES)), np.uint8)
    for k in range(n):
        codes[..., k] = codec.encode_log(D[..., k], *ranges[k])
    out = []
    for m in range(len(FLOOR_FILES)):
        buf = io.BytesIO()
        Image.fromarray(np.ascontiguousarray(codes[..., 4 * m:4 * m + 4])).save(buf, format="PNG", compress_level=9)
        out.append(buf.getvalue())
    return out


@dataclass(frozen=True)
class Tile:
    """One served tile's records: its file name, the .sog's SHA-256, its level (None for the environment) and its
    count x 12 record bytes in the tile's own splat order."""
    name: str
    sha256: str
    level: int | None
    records: bytes


@dataclass(frozen=True, eq=False)
class Inputs:
    """What the package carries besides the tiles' records, from the verified work artifacts (the records command)."""
    room: str
    tile_to_model: np.ndarray      # (4, 4) T_EJ: the served tiles' json frame to the model (e57) frame
    site: dict                     # latitude, longitude, north, east, up (model frame)
    capture: dict                  # capture_of(fit.json)
    lamps: dict                    # lamps_of(...)
    volumes: dict                  # WINDOW_IDS -> windows.WindowVolume (windows.npz)
    horizons: dict                 # WINDOW_IDS -> (360,) horizon elevations (windows.npz)
    fresnel: np.ndarray            # (101,) float32 (windows.npz)
    probes: dict                   # probes-coarse.npz: cubes (M, 9, 3, 6) float16, valid (M,), origin, shape, spacing
    sky: dict                      # sun-bounce.npz: SKY_ARRAYS and SKY_FRAME
    floor: dict                    # floor-light.npz: D (h, w, 9) float32, texelToModel (4, 4); texel (m)
    presets: dict                  # 05_relight.SCENARIOS' night, sunny_morning and overcast_noon
    evidence: dict                 # sunCheck, skyBounce, refit, artifacts


def _floats(a) -> list:
    return [float(v) for v in np.asarray(a, np.float64).ravel()]


def _whole(value, what) -> int:
    v = float(value)
    if v != round(v):
        raise ValueError(f"{what} {v} is not a whole number")
    return int(round(v))


def _windows_section(inputs: Inputs) -> list:
    ids = [wid for wid in inputs.volumes]
    if ids != list(WINDOW_IDS):
        raise ValueError(f"the window volumes are {ids}, not {list(WINDOW_IDS)} in order")
    north = np.asarray(inputs.site["north"], np.float64)
    out, res = [], None
    for wid in WINDOW_IDS:
        vol = inputs.volumes[wid]
        frame = W.volume_arrays(vol)[1]
        res = vol.res if res is None else res
        if vol.res != res:
            raise ValueError(f"{wid}'s cell is {vol.res} m, not {res} m: the windows share one occupancy grid")
        b = math.radians(vol.x_bearing)
        if not (abs(north[0] - math.cos(b)) <= 1e-9 and abs(north[1] - math.sin(b)) <= 1e-9 and north[2] == 0.0):
            raise ValueError(f"site.north {north.tolist()} does not point along {wid}'s x_bearing {vol.x_bearing}")
        horizon = np.asarray(inputs.horizons[wid])
        if horizon.shape != (360,):
            raise ValueError(f"{wid}'s horizon has {horizon.shape} values, not 360")
        out.append({"id": wid, "frame": _floats(frame), "volume": window_file(wid), "horizon": _floats(horizon)})
    return out


def _sky_section(inputs: Inputs) -> tuple[dict, dict]:
    """The manifest's `sky` and its six files' bytes (gzipped) from sun-bounce.npz's arrays."""
    sky = inputs.sky
    for name, dtype in SKY_ARRAYS.items():
        if np.asarray(sky[name]).dtype != np.dtype(dtype):
            raise ValueError(f"sun-bounce.npz's {name} is {np.asarray(sky[name]).dtype}, not {np.dtype(dtype)}")
    basis, coeffs = sky["basis"], sky["coeffs"]
    k = int(basis.shape[0])                       # read from the data, never a constant
    if not 1 <= k <= K_MAX:
        raise ValueError(f"K {k} is outside 1..{K_MAX}")
    shape = [int(v) for v in np.asarray(sky["gridShape"]).ravel()]
    m1 = int(np.prod(shape))
    rows, columns = int(coeffs.shape[0]), int(coeffs.shape[1])
    count = int(sky["patchArea"].shape[0])
    expected = {"basis": (k, m1, 3, 6), "valid": (m1,), "coeffs": (rows, columns, len(WINDOW_IDS), k),
                "patchRays": (SUBSAMPLES * count, 3), "patchNormal": (count, 3), "patchArea": (count,), "floorMean": (k, 3)}
    for name, want in expected.items():
        if tuple(sky[name].shape) != want:
            raise ValueError(f"sun-bounce.npz's {name} is {tuple(sky[name].shape)}, not {want}")
    origin = np.asarray(sky["gridOrigin"], np.float64)
    if not np.array_equal(origin, np.asarray(inputs.probes["origin"], np.float64)):
        raise ValueError(f"the basis grid's origin {origin.tolist()} is not the probes' origin")
    section = {"k": k, "bodies": ["sun", "moon"],
               "grid": {"origin": _floats(origin), "spacing": float(sky["gridSpacing"]), "shape": shape},
               "basis": SKY_FILES["basis"], "valid": SKY_FILES["valid"],
               "table": {"azimuth0": _whole(sky["azimuth0"], "azimuth0"), "elevation0": _whole(sky["elevation0"], "elevation0"),
                         "step": _whole(sky["step"], "step"), "size": [columns, rows], "file": SKY_FILES["table"]},
               "patches": {"count": count, "subsamples": SUBSAMPLES, "rays": SKY_FILES["rays"], "normals": SKY_FILES["normals"],
                           "areas": SKY_FILES["areas"]},
               "floorMean": [_floats(row) for row in sky["floorMean"]]}
    files = {SKY_FILES["basis"]: gz(np.ascontiguousarray(basis, "<f2").tobytes()),
             SKY_FILES["valid"]: gz(np.asarray(sky["valid"], bool).astype(np.uint8).tobytes()),
             SKY_FILES["table"]: gz(np.ascontiguousarray(coeffs, "<f4").tobytes()),
             SKY_FILES["rays"]: gz(np.ascontiguousarray(sky["patchRays"], "<f4").tobytes()),
             SKY_FILES["normals"]: gz(np.ascontiguousarray(sky["patchNormal"], "<f4").tobytes()),
             SKY_FILES["areas"]: gz(np.ascontiguousarray(sky["patchArea"], "<f4").tobytes())}
    return section, files


def write(out, inputs: Inputs, tiles, ranges, *, tool: str, created_at: str, build: dict, skins=None) -> dict:
    """Write the package into the folder `out` and return its manifest (Task 5 Step 6).

    tiles: a Tile per served tile, in the manifest's order; ranges: the nine sources' (lo, hi) (codec.source_range over
    the finest level's direct light); tool and created_at: the commit that built it and that commit's committer time,
    never the wall clock; build: the options it was built with ({skins, skinLight, skinPackage}, each a path or None);
    skins (package v2): (section, {path: gzip bytes}, {artifact: sha256}) from skinlight.skins_section, or None.
    The folder is replaced whole (an existing `out` must be empty or a relight package)."""
    if len(ranges) != len(codec.SOURCES) or not all(hi > lo for lo, hi in ranges):
        raise ValueError("the records need nine (lo, hi) ranges with hi above lo")
    names = [t.name for t in tiles]
    if not tiles or len(set(names)) != len(names):
        raise ValueError("the package needs each served tile once")
    files, entries = {}, []
    for t in tiles:
        if len(t.records) % codec.RECORD_BYTES or not t.records:
            raise ValueError(f"{t.name}: {len(t.records)} record bytes is not a whole number of records")
        data = gz(t.records)
        files[tile_file(t.name)] = data
        entries.append({"tile": t.name, "tileSha256": t.sha256, "level": t.level, "count": len(t.records) // codec.RECORD_BYTES,
                        "file": tile_file(t.name), "sha256": sha256_bytes(data), "bytes": len(data)})
    probes = inputs.probes
    probe_shape = [int(v) for v in np.asarray(probes["shape"]).ravel()]
    cubes = np.asarray(probes["cubes"])
    if cubes.dtype != np.float16 or cubes.shape != (int(np.prod(probe_shape)), len(codec.SOURCES), 3, 6):
        raise ValueError(f"the probe cubes are {cubes.dtype} {cubes.shape}, not float16 per probe, source, channel and face")
    files[PROBES_FILE] = gz(np.ascontiguousarray(cubes, "<f2").tobytes())
    files[PROBE_VALID_FILE] = gz(np.asarray(probes["valid"], bool).astype(np.uint8).tobytes())
    windows = _windows_section(inputs)
    for wid in WINDOW_IDS:
        files[window_file(wid)] = gz(np.ascontiguousarray(inputs.volumes[wid].alpha, np.uint8).tobytes())
    sky, sky_files = _sky_section(inputs)
    files.update(sky_files)
    D = np.asarray(inputs.floor["D"])
    if D.ndim != 3 or D.shape[2] != len(codec.SOURCES):
        raise ValueError(f"the floor light maps are {D.shape}, not (h, w, 9)")
    floor_ranges = [codec.source_range(D[..., k]) for k in range(len(codec.SOURCES))]
    files.update(zip(FLOOR_FILES, floor_maps(D, floor_ranges)))
    evidence = {**inputs.evidence, "build": dict(build)}
    manifest = {
        "schema": SCHEMA, "room": inputs.room, "createdAt": created_at, "tool": tool,
        "model": {"frame": "e57", "tileToModel": _floats(np.asarray(inputs.tile_to_model, np.float64).reshape(4, 4))},
        "site": {"latitude": float(inputs.site["latitude"]), "longitude": float(inputs.site["longitude"]),
                 "north": _floats(inputs.site["north"]), "east": _floats(inputs.site["east"]), "up": _floats(inputs.site["up"])},
        "sources": list(codec.SOURCES),
        "encoding": {"record": codec.RECORD_BYTES, "sources": [[float(lo), float(hi)] for lo, hi in ranges],
                     "floor": [[float(lo), float(hi)] for lo, hi in floor_ranges],
                     "multiplier": {"lo": int(codec.MULT_LO), "hi": int(codec.MULT_HI)}},
        "capture": inputs.capture, "lamps": inputs.lamps,
        "sun": {"fresnel": _floats(inputs.fresnel)},
        "sky": sky, "windows": windows,
        "probes": {"origin": _floats(probes["origin"]), "spacing": float(probes["spacing"]), "shape": probe_shape,
                   "file": PROBES_FILE, "validFile": PROBE_VALID_FILE},
        "floor": {"skin": FLOOR_SKIN, "texelToModel": _floats(np.asarray(inputs.floor["texelToModel"], np.float64).reshape(4, 4)),
                  "texel": float(inputs.floor["texel"]), "size": [int(D.shape[1]), int(D.shape[0])], "files": list(FLOOR_FILES)},
        "tiles": entries, "presetsFromProof": inputs.presets, "evidence": evidence}
    if skins is not None:
        section, skin_files, skin_artifacts = skins
        files.update(skin_files)
        manifest["skins"] = section
        manifest["visibility"] = skins_visibility()
        evidence["artifacts"] = {**evidence["artifacts"], **skin_artifacts}
    manifest["files"] = {path: {"sha256": sha256_bytes(data), "bytes": len(data)} for path, data in files.items()}
    _replace_folder(out, files, dump_manifest(manifest))
    return manifest


def skins_visibility() -> dict:
    from . import skinlight
    return dict(skinlight.VISIBILITY)


def _replace_folder(out, files: dict, manifest_bytes: bytes) -> None:
    """Write every file into a fresh folder beside `out` (manifest.json last) and swap it in, so `out` holds exactly
    this package. An existing `out` is replaced only when it is empty or holds a relight package's manifest."""
    out = os.path.abspath(out)
    if os.path.isdir(out) and os.listdir(out):
        try:
            with open(os.path.join(out, "manifest.json"), encoding="utf-8") as f:
                schema = json.load(f).get("schema")
        except (OSError, ValueError):
            schema = None
        if schema != SCHEMA:
            raise ValueError(f"{out} holds files but no relight package; refusing to replace it")
    stage, old = out + ".part", out + ".old"
    for folder in (stage, old):
        if os.path.exists(folder):
            shutil.rmtree(folder)
    for rel, data in files.items():
        path = os.path.join(stage, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
    with open(os.path.join(stage, "manifest.json"), "wb") as f:
        f.write(manifest_bytes)
    if os.path.exists(out):
        os.replace(out, old)
    os.replace(stage, out)
    if os.path.exists(old):
        shutil.rmtree(old)


# ------------------------------------------------------------------------------------------------------- reading back
@dataclass(frozen=True, eq=False)
class Package:
    """A package read back from disk: its manifest, and its files, each checked against the manifest's SHA-256 and size
    when it is read."""
    folder: str
    manifest: dict

    def data(self, rel: str) -> bytes:
        entry = self.manifest["files"].get(rel)
        if entry is None:
            raise ValueError(f"{rel} is not among the package's files")
        with open(os.path.join(self.folder, *rel.split("/")), "rb") as f:
            data = f.read()
        if len(data) != entry["bytes"] or sha256_bytes(data) != entry["sha256"]:
            raise ValueError(f"{rel} does not match its checksum in the manifest")
        return data

    def gunzip(self, rel: str) -> bytes:
        return gzip.decompress(self.data(rel))

    def tile(self, name: str) -> dict:
        for entry in self.manifest["tiles"]:
            if entry["tile"] == name:
                return entry
        raise ValueError(f"the package has no tile {name}")

    def records(self, name: str) -> np.ndarray:
        """(count, 12) uint8: the tile's records, as written."""
        entry = self.tile(name)
        data = self.gunzip(entry["file"])
        if len(data) != entry["count"] * codec.RECORD_BYTES:
            raise ValueError(f"{entry['file']} holds {len(data)} bytes for {entry['count']} records")
        return np.frombuffer(data, np.uint8).reshape(-1, codec.RECORD_BYTES)

    def ranges(self) -> list:
        return [tuple(r) for r in self.manifest["encoding"]["sources"]]


def read(folder) -> Package:
    with open(os.path.join(folder, "manifest.json"), "rb") as f:
        manifest = json.loads(f.read())
    if manifest.get("schema") != SCHEMA:
        raise ValueError(f"{folder} is not a {SCHEMA} package")
    return Package(os.path.abspath(folder), manifest)


def decode(records, ranges):
    """(direct (n, 9), normals (n, 3), flags (n,)) of (n, 12) record bytes, as the browser decodes them."""
    return codec.unpack_records(np.ascontiguousarray(records, np.uint8).tobytes(), ranges)


def sky_arrays(pkg: Package) -> dict:
    """The sky files and floorMean read back with sun-bounce.npz's names, dtypes and shapes (check 5a compares them)."""
    sky = pkg.manifest["sky"]
    k = int(sky["k"])
    m1 = int(np.prod([int(v) for v in sky["grid"]["shape"]]))
    columns, rows = (int(v) for v in sky["table"]["size"])
    count = int(sky["patches"]["count"])
    f32 = lambda rel, shape: np.frombuffer(pkg.gunzip(rel), "<f4").reshape(shape)
    return {"basis": np.frombuffer(pkg.gunzip(sky["basis"]), "<f2").reshape(k, m1, 3, 6),
            "valid": np.frombuffer(pkg.gunzip(sky["valid"]), np.uint8).astype(bool).reshape(m1),
            "coeffs": f32(sky["table"]["file"], (rows, columns, len(WINDOW_IDS), k)),
            "patchRays": f32(sky["patches"]["rays"], (SUBSAMPLES * count, 3)),
            "patchNormal": f32(sky["patches"]["normals"], (count, 3)),
            "patchArea": f32(sky["patches"]["areas"], (count,)),
            "floorMean": np.asarray(sky["floorMean"], np.float32).reshape(k, 3)}


def model_of(pkg: Package) -> reference.Model:
    """The reference model from the package's own files (check, Step 7): the probes, each window through
    windows.volume_from_arrays from its gzip and frame, the horizons and the glass from the manifest, and the sky
    bodies' bounce from the sky files and fields."""
    m = pkg.manifest
    pr = m["probes"]
    shape = tuple(int(v) for v in pr["shape"])
    count = int(np.prod(shape))
    cubes = np.frombuffer(pkg.gunzip(pr["file"]), "<f2").reshape(count, len(codec.SOURCES), 3, 6)
    valid = np.frombuffer(pkg.gunzip(pr["validFile"]), np.uint8).astype(bool).reshape(count)
    volumes, horizons = {}, {}
    for w in m["windows"]:
        frame = np.asarray(w["frame"], np.float64)
        nx, ny, nz = (int(v) for v in frame[4:7])
        alpha = np.frombuffer(pkg.gunzip(w["volume"]), np.uint8).reshape(nx, ny, nz)
        volumes[w["id"]] = W.volume_from_arrays(w["id"], alpha, frame)
        horizons[w["id"]] = np.asarray(w["horizon"], np.float32)
    arrays, sky = sky_arrays(pkg), m["sky"]
    table = sunbounce.Table(coeffs=arrays["coeffs"], az0=float(sky["table"]["azimuth0"]), el0=float(sky["table"]["elevation0"]),
                            step=float(sky["table"]["step"]))
    bounce = reference.SkyBounce(table=table, basis=arrays["basis"], origin=np.asarray(sky["grid"]["origin"], np.float64),
                                 spacing=float(sky["grid"]["spacing"]), shape=tuple(int(v) for v in sky["grid"]["shape"]),
                                 valid=arrays["valid"],
                                 patches=sunbounce.Patches(rays=arrays["patchRays"], normals=arrays["patchNormal"],
                                                           areas=arrays["patchArea"]),
                                 floor_mean=arrays["floorMean"])
    cap = m["capture"]
    return reference.Model(capture_w=np.asarray(cap["weights"], np.float64), capture_c=np.asarray(cap["colours"], np.float64),
                           daylight_colour=np.asarray(cap["daylightColour"], np.float64), probes=cubes, probe_valid=valid,
                           probe_origin=np.asarray(pr["origin"], np.float64), probe_spacing=float(pr["spacing"]),
                           probe_shape=shape, volumes=volumes, fresnel=np.asarray(m["sun"]["fresnel"], np.float32),
                           horizons=horizons, sky=bounce)


# ------------------------------------------------------------------------------------------ what check writes and compares
def write_check_evidence(folder, results: dict) -> bytes:
    """Replace the six keys `check` adds to the package's evidence (CHECK_KEYS) with `results`' and nothing else, the
    manifest dumped with the build's own arguments through a partial file renamed over it. Returns the new bytes."""
    path = os.path.join(folder, "manifest.json")
    with open(path, encoding="utf-8") as f:
        manifest = json.load(f)
    kept = {k: v for k, v in manifest["evidence"].items() if k not in CHECK_KEYS}
    manifest["evidence"] = {**kept, **{k: results[k] for k in CHECK_KEYS}}
    data = dump_manifest(manifest)
    part = path + ".part"
    try:
        with open(part, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(part, path)
    except BaseException:
        if os.path.exists(part):
            os.remove(part)
        raise
    return data


def compare(checked, rebuilt) -> dict:
    """Check 4's comparison of a package on disk (`checked`) with a second write of it (`rebuilt`): the same files,
    each byte for byte, and the same manifest once the keys `check` adds are removed from the checked one and it is
    dumped again with the build's own arguments."""
    a, b = read(checked), read(rebuilt)
    files_a, files_b = a.manifest["files"], b.manifest["files"]
    differ = sorted(set(files_a) ^ set(files_b))
    for rel in sorted(set(files_a) & set(files_b)):
        with open(os.path.join(a.folder, *rel.split("/")), "rb") as fa, open(os.path.join(b.folder, *rel.split("/")), "rb") as fb:
            if fa.read() != fb.read():
                differ.append(rel)
    stripped = {**a.manifest, "evidence": {k: v for k, v in a.manifest["evidence"].items() if k not in CHECK_KEYS}}
    with open(os.path.join(b.folder, "manifest.json"), "rb") as f:
        manifest_same = dump_manifest(stripped) == f.read()
    return {"files": len(files_a), "differ": differ, "manifestIdentical": bool(manifest_same),
            "pass": bool(not differ and manifest_same)}
