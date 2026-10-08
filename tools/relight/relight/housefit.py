"""The house lights refitted (T-639 R1a Task 4b): the capture's light fit of proof/04_fit.py, run by the same loop, with
the house lights parameterised by the frontier splats study's bulb table instead of free per-group weights.

The proof's fit gives the centre chandelier a weight of 1.4e-11 (its bound) although the 31 May walk saw it lit
throughout; albedo flatness cannot tell its light from the dome ring's and the end chandeliers', so they took it.

RefitModel: one per-bulb intensity phi for every chandelier candle. The lamps are the table's "high" and "medium"
entries (the splats study's 140); "low" and "exclude" entries are not lamps. The centre chandelier's crown tubes (its
"medium" entries whose reading names them) are a second kind of lamp, each w_crown x phi, with w_crown measured from the
table's clipped cores (crown_weight), a default the plan's sensitivity runs bracket at 0 and 1. 03_bases.py's E_ch[:, 0]
is the four end chandeliers' unit point lights summed and E_ch[:, 1] the centre chandelier's, so ch_end weighs phi x the
mean lamp count of the four ends and ch_centre phi x (its candles + w_crown x its crown tubes): their ratio is that
count ratio exactly. A colour per lamp group
(cove, chandeliers, dome): the measured lamp/daylight ratio times exp of a fitted (R/G, B/G) offset held by a prior per
group (colour_priors). Everything else is 04_fit.py's. ProofModel is 04_fit.py's own parameterisation through the same
loop: it reproduces the proof's fit and is the baseline the refit's data cost is judged against. The plan's Task 4b
gives the reasons for each choice.
"""
from __future__ import annotations

import hashlib, json, math, os, shutil, time
from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares

BULBS_SCHEMA = "venviewer.frontier.bulbs.v1"
SHARES_SCHEMA = "venviewer.bulb-intensities.v1"
CHANDELIERS = 5
CENTRE = 2
ENDS = (0, 1, 3, 4)
VOLUME_RADIUS = (0.75, 0.75, 1.0, 0.75, 0.75)    # 02_geometry.py's chandelier volumes (horizontal radius, m)
VOLUME_MARGIN = 0.10                            # two triangulated bulbs stand a few mm outside the radius
CENTROID_TOLERANCE = 0.25                       # a chandelier's lamps' median stands this close to its model centre (m)
FRAME_TOLERANCE = 1e-9
LIGHTS = ("W1", "W2", "W3", "W4", "W5", "sun_cap", "cove", "ch_end", "ch_centre", "dome")   # 04_fit.BASES
COLOUR_PRIOR_SIGMA = {"cove": 0.35, "chandeliers": 0.035, "dome": 0.10}   # natural log: 0.5, 0.05 and 0.15 stop
PRIOR_WEIGHT = 0.15                             # 04_fit.py's prior strength
OFFSET_BOUND = 1.0                              # a lamp colour offset stays within e^+-1 (1.44 stops)
LOG_BOUNDS = (-25.0, 12.0)                      # 04_fit.py's bounds on the log weights
RESIDUAL_TOLERANCE = 0.02                       # the refit's data cost may exceed the proof model's by at most 2%
RATIO_TOLERANCE = 1e-9
BOUND_MARGIN = 0.01
REPRODUCE_TOLERANCE = 0.01                      # the proof model against fit.json (Task 2's bar)
LAMP_WORDS = ("high", "medium")                 # the lamps: the splats study's 140 (the controller's ruling L1, 8 October)
NOT_LAMP_WORDS = ("low", "exclude")             # unresolved by eye, or a brass highlight or glare: not lamps
CANDLE, CROWN = "candle", "crown"               # the two kinds of lamp (ruling L2)
CROWN_TEXT = "crown tube"                       # a centre-chandelier "medium" reading that names the crown tubes
CROWN_WEIGHT_RANGE = (0.0, 1.0)                 # w_crown, a crown tube's intensity over a candle's
CROWN_ENDS = (0.0, 1.0)                         # the sensitivity runs' w_crown
DEFAULT_TAG = "refit"                           # the refit at the measured w_crown; a sensitivity run is refit-wcrown-<w>
RANGE_FACE_MIN = 2                              # a face's intercept in the range fit needs at least two fitted candles
RANGE_SPREAD_FACTOR = 2.0                       # the centre's range-aware balance within 2x the largest end spread (L4)
PHOTO_VIEWS = ("mp43_night_end", "mp45_night_windows")
PHOTO_JOB = "A_comp_house"
PHOTO_R_SLACK = 0.005
PHOTO_STOPS_SLACK = 0.02
PHOTO_METRICS = (("r", 1.0), ("mae_affine_stops", -1.0), ("chroma_rg", -1.0), ("chroma_bg", -1.0))   # +1: higher is better
METRIC_ROUNDING = 0.001                         # 07_compare.py rounds every metric to 3 decimals
FIT_FILES = ("fit.json", "fit_state.npz", "npy/E_cap.npy", "npy/emb_E_back_cap.npy")
SNAPSHOT = "fit-proof"
SCENARIOS = ("comp_house", "mask", "night", "sunny_morning", "overcast_noon")


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def confidence_word(entry) -> str:
    """The by-eye reading's first word ("high: ...", "medium: ..."); any word but the table's four is refused."""
    word = str(entry.get("confidence", "")).split(":")[0].strip()
    if word not in LAMP_WORDS + NOT_LAMP_WORDS:
        raise ValueError(f"bulb {entry.get('id')!r}: unknown confidence {entry.get('confidence')!r}")
    return word


def is_lamp(entry) -> bool:
    """A lamp is a "high" or "medium" entry (ruling L1: the splats study's 140); "low" (unresolved by eye) and "exclude"
    (a brass highlight or glare) are not lamps."""
    return confidence_word(entry) in LAMP_WORDS


def lamp_kind(entry) -> str:
    """CROWN for the centre chandelier's crown tubes, its "medium" entries whose reading names them (ruling L2); every
    other lamp is a CANDLE."""
    if not is_lamp(entry):
        raise ValueError(f"bulb {entry.get('id')!r} is not a lamp")
    crown = (int(entry["chandelier"]) == CENTRE and confidence_word(entry) == "medium"
             and CROWN_TEXT in str(entry["confidence"]))
    return CROWN if crown else CANDLE


def blob_balance(bulbs) -> dict:
    """Evidence for one per-bulb intensity, never fitted: in each face that frames candles of the centre chandelier and
    of an end chandelier (one exposure), log2 of the centre's median clipped-core area (mm2 at the bulb) over the ends';
    the median over those faces. The area is a relative, monotone proxy of intensity within one face (the table's note).
    The crown tubes are left out: crown_weight measures them."""
    faces = {}
    for b in bulbs:
        if not is_lamp(b) or lamp_kind(b) == CROWN:
            continue
        side = "centre" if int(b["chandelier"]) == CENTRE else "end"
        for f in b.get("faces", []):
            area = f.get("blob_area_mm2")
            if area is not None and area > 0:
                faces.setdefault(f["face"], {"centre": [], "end": []})[side].append(float(area))
    logs = [math.log2(float(np.median(v["centre"])) / float(np.median(v["end"]))) for v in faces.values() if v["centre"] and v["end"]]
    return {"faces": len(logs), "medianLog2CentreOverEnd": float(np.median(logs)) if logs else None}


def crown_weight(bulbs) -> dict:
    """w_crown's measured default (ruling L2), never fitted: in each face that frames crown tubes and candles of the
    centre chandelier (one exposure), each crown tube's clipped-core area (mm2 at the bulb) over the median of those
    candles'; the median over every such (tube, face) pair. The area is a relative, monotone proxy of intensity within one
    face (the table's note), so this is a default, which the sensitivity runs bracket at 0 and 1. A table without crown
    tubes, or whose crown tubes share no face with a candle, is refused."""
    faces = {}
    for b in bulbs:
        if int(b["chandelier"]) != CENTRE or not is_lamp(b):
            continue
        kind = lamp_kind(b)
        for f in b.get("faces", []):
            area = f.get("blob_area_mm2")
            if area is not None and area > 0:
                faces.setdefault(f["face"], {CANDLE: [], CROWN: []})[kind].append(float(area))
    shared = [v for v in faces.values() if v[CROWN] and v[CANDLE]]
    ratios = [a / float(np.median(v[CANDLE])) for v in shared for a in v[CROWN]]
    if not ratios:
        raise ValueError("no face frames both a crown tube and a candle of the centre chandelier (or the table names no "
                         "crown tubes): w_crown cannot be measured")
    return {"wCrown": float(np.median(ratios)), "pairs": len(ratios), "faces": len(shared)}


def candle_detections(bulbs) -> list:
    """Every detection of a candle with a positive clipped area and range: (chandelier, face, log2 of its clipped area in
    mm2 at the bulb (blob_area_mm2), log2 of the face's station-to-bulb range in m (distance_m))."""
    out = []
    for b in bulbs:
        if not is_lamp(b) or lamp_kind(b) != CANDLE:
            continue
        for f in b.get("faces", []):
            area, rng = f.get("blob_area_mm2"), f.get("distance_m")
            if area is not None and rng is not None and area > 0 and rng > 0:
                out.append((int(b["chandelier"]), str(f["face"]), math.log2(float(area)), math.log2(float(rng))))
    return out


def range_fit(detections):
    """log2 area = a_face + slope x log2 range, least squares with a per-face intercept (one exposure per face) and one
    shared slope, over the faces holding at least RANGE_FACE_MIN of these detections: (slope, {face: a_face}), or None
    when no face does or the ranges never vary within a face."""
    faces = {}
    for _c, face, y, x in detections:
        faces.setdefault(face, []).append((x, y))
    faces = {f: np.asarray(v, np.float64) for f, v in faces.items() if len(v) >= RANGE_FACE_MIN}
    sxx = sum(float(((v[:, 0] - v[:, 0].mean()) ** 2).sum()) for v in faces.values())
    if sxx <= 0.0:
        return None
    slope = sum(float(((v[:, 0] - v[:, 0].mean()) * (v[:, 1] - v[:, 1].mean())).sum()) for v in faces.values()) / sxx
    return slope, {f: float(v[:, 1].mean() - slope * v[:, 0].mean()) for f, v in faces.items()}


def median_residual(detections, fit):
    """(the median residual of these detections against a range fit, in log2, and how many faces of the fit held them)."""
    slope, intercepts = fit
    r = [y - intercepts[face] - slope * x for _c, face, y, x in detections if face in intercepts]
    return (float(np.median(r)) if r else None), len(r)


def range_balance(bulbs) -> dict:
    """Ruling L4: whether the clipped cores contradict one intensity per candle once range is taken out. The range fit
    is made on the four end chandeliers' candles; the centre's candles' median residual against it is the corrected
    balance. Each end chandelier's median residual against the fit of the other three (leave-one-out) is its spread;
    the centre passes within RANGE_SPREAD_FACTOR x the largest |spread|. Never raises: a table it cannot judge fails,
    with the reason."""
    detections = candle_detections(bulbs)
    ends = [d for d in detections if d[0] in ENDS]
    centre = [d for d in detections if d[0] == CENTRE]
    out = {"factor": RANGE_SPREAD_FACTOR, "faceMin": RANGE_FACE_MIN, "detections": {"ends": len(ends), "centre": len(centre)},
           "slope": None, "faces": 0, "balance": None, "centreUsed": 0, "endSpreads": {}, "largestEndSpread": None,
           "limit": None, "pass": False, "reason": None}
    fit = range_fit(ends)
    if fit is None:
        out["reason"] = "the end chandeliers' candles give no range fit (no face holds two of them at different ranges)"
        return out
    out["slope"], out["faces"] = fit[0], len(fit[1])
    out["balance"], out["centreUsed"] = median_residual(centre, fit)
    for c in ENDS:
        others = range_fit([d for d in ends if d[0] != c])
        out["endSpreads"][str(c)] = None if others is None else median_residual([d for d in ends if d[0] == c], others)[0]
    if out["balance"] is None or any(v is None for v in out["endSpreads"].values()):
        out["reason"] = "the centre's candles or an end chandelier share no fitted face"
        return out
    out["largestEndSpread"] = max(abs(v) for v in out["endSpreads"].values())
    out["limit"] = RANGE_SPREAD_FACTOR * out["largestEndSpread"]
    out["pass"] = bool(abs(out["balance"]) <= out["limit"])
    if not out["pass"]:
        out["reason"] = "the centre's candles differ from the ends' by more than the ends differ among themselves"
    return out


def read_bulbs(path, chandelier_centres, t_json_from_e57=None) -> dict:
    """The bulb table: every id; the lamps per chandelier ("high" and "medium"; each chandelier's checked to stand around
    the light model's chandelier of the same index) and each lamp's kind (every crown tube above all the centre
    chandelier's candles); the entries that are not lamps ("low" and "exclude"); the clipped-core evidence (the centre's
    candles against the ends', the crown tubes' measured weight, the range-aware balance of ruling L4) and the table's
    SHA-256."""
    with open(path, "rb") as f:
        raw = f.read()
    data = json.loads(raw)
    if data.get("schema") != BULBS_SCHEMA:
        raise ValueError(f"{path}: the bulb table must be {BULBS_SCHEMA}")
    if t_json_from_e57 is not None:
        theirs = np.asarray(data.get("frames", {}).get("T_json_from_e57"), np.float64)
        if theirs.shape != (4, 4) or float(np.abs(theirs - np.asarray(t_json_from_e57, np.float64)).max()) > FRAME_TOLERANCE:
            raise ValueError(f"{path}: the table's T_json_from_e57 is not the canonical frame's")
    centres = np.asarray(chandelier_centres, np.float64)
    if centres.shape != (CHANDELIERS, 3):
        raise ValueError("the light model has five chandelier centres")
    ids, lamps, not_lamps, kinds = set(), {c: [] for c in range(CHANDELIERS)}, [], {}
    for entry in data["bulbs"]:
        bid, c = str(entry["id"]), int(entry["chandelier"])
        if not 0 <= c < CHANDELIERS or not bid.startswith(f"c{c}_b"):
            raise ValueError(f"bulb {bid!r}: its id and its chandelier {c} disagree")
        if bid in ids:
            raise ValueError(f"bulb {bid} appears twice")
        ids.add(bid)
        if is_lamp(entry):
            lamps[c].append((bid, np.asarray(entry["position_e57"], np.float64)))
            kinds[bid] = lamp_kind(entry)
        else:
            not_lamps.append(bid)
    counts, candles = {}, {}
    for c in range(CHANDELIERS):
        if not lamps[c]:
            raise ValueError(f"chandelier {c} has no lamp in the table: the refit needs all five")
        P = np.stack([p for _bid, p in lamps[c]])
        off = float(np.hypot(*(np.median(P, 0)[:2] - centres[c, :2])))
        reach = float(np.hypot(P[:, 0] - centres[c, 0], P[:, 1] - centres[c, 1]).max())
        if off > CENTROID_TOLERANCE or reach > VOLUME_RADIUS[c] + VOLUME_MARGIN:
            raise ValueError(f"chandelier {c}'s lamps do not stand around the light model's chandelier {c} "
                             f"(median {off:.3f} m off its axis, farthest {reach:.3f} m)")
        counts[c] = len(lamps[c])
        candles[c] = sum(1 for bid, _p in lamps[c] if kinds[bid] == CANDLE)
    crowns = sorted(bid for bid, kind in kinds.items() if kind == CROWN)
    height = {bid: float(p[2]) for bid, p in lamps[CENTRE]}
    lowest_crown = min((height[bid] for bid in crowns), default=math.inf)
    highest_candle = max((z for bid, z in height.items() if kinds[bid] == CANDLE), default=-math.inf)
    if lowest_crown <= highest_candle:
        raise ValueError(f"a crown tube stands at {lowest_crown:.3f} m, not above every candle of the centre chandelier "
                         f"(the highest at {highest_candle:.3f} m): the reading that names the crown tubes is wrong here")
    return {"sha256": hashlib.sha256(raw).hexdigest(), "ids": sorted(ids), "counts": counts, "candles": candles,
            "crowns": crowns, "kinds": dict(sorted(kinds.items())),
            "lamps": {c: sorted(b for b, _p in lamps[c]) for c in range(CHANDELIERS)}, "notLamps": sorted(not_lamps),
            "blobBalance": blob_balance(data["bulbs"]), "crownWeight": crown_weight(data["bulbs"]),
            "rangeBalance": range_balance(data["bulbs"])}


@dataclass(frozen=True)
class LampCounts:
    end_mean: float          # mean lamps per end chandelier, every one a candle (the four summed in E_ch[:, 0])
    centre_candles: float    # the centre chandelier's candles (E_ch[:, 1])
    crowns: float            # the centre chandelier's crown tubes
    w_crown: float           # a crown tube's intensity over a candle's

    @property
    def centre(self) -> float:
        """The centre chandelier's light in candles: its candles plus w_crown x its crown tubes."""
        return self.centre_candles + self.w_crown * self.crowns

    @property
    def ratio(self) -> float:
        return self.centre / self.end_mean


def lamp_counts(bulbs, w_crown) -> LampCounts:
    """read_bulbs' lamps at a crown weight within CROWN_WEIGHT_RANGE."""
    w = float(w_crown)
    if not (math.isfinite(w) and CROWN_WEIGHT_RANGE[0] <= w <= CROWN_WEIGHT_RANGE[1]):
        raise ValueError(f"w_crown {w_crown!r} is outside {CROWN_WEIGHT_RANGE}")
    candles = bulbs["candles"]
    return LampCounts(sum(candles[c] for c in ENDS) / len(ENDS), float(candles[CENTRE]), float(len(bulbs["crowns"])), w)


def colour_priors(lamp_colours) -> dict:
    """Each lamp group's prior offset (natural log of R/G and B/G) from the measured lamp/daylight ratio: the chandeliers
    at 0 (the ratio was measured on their splats, 94% of the sample), the dome at its emitter splats' measured shift from
    the chandeliers', the cove at 0 (its splats measure the tape times the albedo, not the tape)."""
    g = lamp_colours["groups"]
    ch, dome = g["chandelier_emitters_all"]["median_log2_RG_BG"], g["dome_ring_emitters"]["median_log2_RG_BG"]
    ln2 = math.log(2.0)
    return {"cove": (0.0, 0.0), "chandeliers": (0.0, 0.0),
            "dome": (ln2 * (float(dome[0]) - float(ch[0])), ln2 * (float(dome[1]) - float(ch[1])))}


@dataclass(frozen=True)
class FitConstants:
    """04_fit.py's constants the loop needs (read from the module; tests give their own)."""
    groups: int
    paint: int
    paint_albedo: float
    huber: float
    gamma_free: bool

    @classmethod
    def of(cls, fit04) -> "FitConstants":
        return cls(len(fit04.GROUPS), int(fit04.PAINT), float(fit04.PAINT_ALBEDO), float(fit04.HUBER), bool(fit04.GAMMA_FREE))


class ProofModel:
    """04_fit.py's parameters: x[0:10] log weights of LIGHTS; x[10:16] the daylight, cove and house colours' (R, B) logs,
    the lamp colours pinned to cday x the measured ratio; then the albedos and log gamma."""
    name, n_log, n_col = "proof", 10, 6

    def __init__(self, lamp_ratio):
        self.lamp_ratio = None if lamp_ratio is None else np.asarray(lamp_ratio, np.float64)

    def init_log(self, w0):
        return np.log(np.asarray(w0, np.float64))

    def weights(self, x):
        return np.exp(np.asarray(x[:10], np.float64))

    def colours(self, x):
        cday, ccove, chouse = (np.exp([x[10 + 2 * i], 0.0, x[11 + 2 * i]]) for i in range(3))
        if self.lamp_ratio is not None:
            ccove = cday * self.lamp_ratio
            chouse = cday * self.lamp_ratio
        return np.stack([cday] * 6 + [ccove] + [chouse] * 3, 0)

    def bounds(self, lo, hi):
        lo[:10], hi[:10] = LOG_BOUNDS
        if self.lamp_ratio is not None:
            lo[12:16], hi[12:16] = -1e-9, 1e-9

    def priors(self, x):
        lw = np.asarray(x[:5], np.float64)
        return np.concatenate([0.15 * (lw - lw.mean()) / 0.6, 0.15 * np.asarray(x[10:16], np.float64) / 0.5])

    def describe(self, x):
        return {"name": self.name}


class RefitModel:
    """x[0:5] the windows' log weights, x[5] the capture's sun, x[6] the cove, x[7] the dome, x[8] log phi (the per-bulb
    chandelier intensity); x[9:11] the daylight colour's (R, B) logs; x[11:13], x[13:15], x[15:17] the cove's, the
    chandeliers' and the dome's colour offsets from cday x the measured ratio; then the albedos and log gamma."""
    name, n_log, n_col = "refit", 9, 8
    OFFSETS = (("cove", 11), ("chandeliers", 13), ("dome", 15))

    def __init__(self, lamp_ratio, counts: LampCounts, priors: dict):
        self.lamp_ratio = np.asarray(lamp_ratio, np.float64)
        self.counts = counts
        self.prior_means = {g: tuple(float(v) for v in priors[g]) for g in COLOUR_PRIOR_SIGMA}

    def init_log(self, w0):
        w0 = np.asarray(w0, np.float64)
        log_phi = 0.5 * (math.log(w0[7] / self.counts.end_mean) + math.log(w0[8] / self.counts.centre))
        return np.r_[np.log(w0[:7]), math.log(w0[9]), log_phi]

    def weights(self, x):
        phi = math.exp(float(x[8]))
        return np.r_[np.exp(np.asarray(x[:7], np.float64)), phi * self.counts.end_mean, phi * self.counts.centre, math.exp(float(x[7]))]

    def colours(self, x):
        cday = np.exp([x[9], 0.0, x[10]])
        base = cday * self.lamp_ratio
        lamp = {g: base * np.exp([x[i], 0.0, x[i + 1]]) for g, i in self.OFFSETS}
        return np.stack([cday] * 6 + [lamp["cove"]] + [lamp["chandeliers"]] * 2 + [lamp["dome"]], 0)

    def bounds(self, lo, hi):
        lo[:9], hi[:9] = LOG_BOUNDS
        lo[11:17], hi[11:17] = -OFFSET_BOUND, OFFSET_BOUND

    def priors(self, x):
        x = np.asarray(x, np.float64)
        lw = x[:5]
        out = [0.15 * (lw - lw.mean()) / 0.6, 0.15 * x[9:11] / 0.5]
        for g, i in self.OFFSETS:
            out.append(PRIOR_WEIGHT * (x[i:i + 2] - np.asarray(self.prior_means[g])) / COLOUR_PRIOR_SIGMA[g])
        return np.concatenate(out)

    def describe(self, x):
        return {"name": self.name, "perBulbIntensity": math.exp(float(x[8])), "logPerBulb": float(x[8]),
                "lampCounts": {"endMean": self.counts.end_mean, "centreCandles": self.counts.centre_candles,
                               "crowns": self.counts.crowns, "wCrown": self.counts.w_crown, "centre": self.counts.centre,
                               "ratio": self.counts.ratio},
                "colourOffsets": {g: [float(x[i]), float(x[i + 1])] for g, i in self.OFFSETS},
                "colourPriors": {g: list(self.prior_means[g]) for g in COLOUR_PRIOR_SIGMA}, "colourPriorSigma": dict(COLOUR_PRIOR_SIGMA)}


def n_params(model, k: FitConstants) -> int:
    return model.n_log + model.n_col + k.groups * 3 - 1 + 1


def unpack(model, x, k: FitConstants):
    """(weights (10,), colours (10, 3), log albedos (groups, 3), gamma), as 04_fit.py's unpack."""
    s = model.n_log + model.n_col
    mu = np.insert(np.asarray(x[s:-1], np.float64), k.paint * 3 + 1, math.log(k.paint_albedo)).reshape(k.groups, 3)
    return model.weights(x), model.colours(x), mu, float(math.exp(float(x[-1])))


def model_light(model, x, Dv, Iv, k: FitConstants):
    """The modelled capture light per voxel (04_fit.py's model_E): (E (V, 3), log albedos, gamma)."""
    wts, cols, mu, gam = unpack(model, x, k)
    return np.einsum("vbc,bc->vc", Dv[:, :, None] + Iv, wts[:, None] * cols), mu, gam


@dataclass
class VoxelData:
    Dv_ok: np.ndarray            # (V, 10) direct light per voxel and light
    Iv_ok: np.ndarray | None     # (V, 10, 3) bounce per voxel, light and channel (set each round)
    logC: np.ndarray             # (V, 3) log of the captured voxel colour
    g_ok: np.ndarray             # (V,) material group
    wg: np.ndarray               # (V,) 1 / sqrt(voxels in the group)
    C: np.ndarray | None = None  # (V, 3) the captured voxel colour (diagnostics)


def residuals(model, x, data: VoxelData, k: FitConstants):
    """(data part, prior part): 04_fit.py's pseudo-Huber residual on log colour per voxel and channel times the group
    weight, and the model's priors."""
    E, mu, gam = model_light(model, x, data.Dv_ok, data.Iv_ok, k)
    r = data.logC - gam * (np.log(np.maximum(E, 1e-9)) + mu[data.g_ok])
    rt = np.sign(r) * k.huber * np.sqrt(2.0 * (np.sqrt(1.0 + (r / k.huber) ** 2) - 1.0))
    return (rt * data.wg[:, None]).ravel(), model.priors(x)


def data_cost(model, x, data: VoxelData, k: FitConstants) -> float:
    d, _p = residuals(model, x, data, k)
    return float(0.5 * np.dot(d, d))


def bounds_of(model, n, k: FitConstants):
    lo, hi = np.full(n, -np.inf), np.full(n, np.inf)
    model.bounds(lo, hi)
    lo[-1], hi[-1] = (math.log(0.3), math.log(1.5)) if k.gamma_free else (-1e-9, 1e-9)
    return lo, hi


def initial_x(model, Dv, k: FitConstants):
    """04_fit.py's start: every light contributes about 0.2 where it is typical."""
    nb = Dv.shape[1]
    dnz = [np.median(Dv[Dv[:, j] > 0, j]) if (Dv[:, j] > 0).any() else 1.0 for j in range(nb)]
    x = np.zeros(n_params(model, k))
    x[:model.n_log] = model.init_log(0.2 / np.maximum(dnz, 1e-9))
    return x


def anchor_albedo(model, x, data: VoxelData, k: FitConstants):
    """04_fit.py's first round: the group albedos the start light implies, every light scaled so the paint band's mean
    green albedo is the anchor."""
    E0, _mu, _g = model_light(model, x, data.Dv_ok, data.Iv_ok, k)
    mu0 = np.stack([np.mean(data.logC[data.g_ok == gi] - np.log(E0[data.g_ok == gi]), 0) for gi in range(k.groups)])
    shift = mu0[k.paint, 1] - math.log(k.paint_albedo)
    x = np.array(x, np.float64)
    x[:model.n_log] += shift
    mu0 -= shift
    x[model.n_log + model.n_col:-1] = np.delete(mu0.ravel(), k.paint * 3 + 1)
    return x


def solve(model, x, data: VoxelData, k: FitConstants):
    """04_fit.py's least_squares call: trust-region reflective, x_scale 'jac', at most 4000 evaluations."""
    lo, hi = bounds_of(model, len(x), k)
    return least_squares(lambda z: np.concatenate(residuals(model, z, data, k)), np.clip(x, lo + 1e-9, hi - 1e-9),
                         bounds=(lo, hi), method="trf", x_scale="jac", max_nfev=4000)


def run_capture_fit(model, k: FitConstants, mods, out_dir, write_ecap, log=print) -> dict:
    """04_fit.py's main with the model's parameters: the fit set and its voxels, four rounds of radiosity, the light fit
    and the patch albedo from it, the diagnostics, and out_dir/fit.json and fit_state.npz in 04_fit.py's shapes (plus the
    model's description); with write_ecap also out_dir/E_cap.npy. mods: fit04, radiosity, store, lt, torch."""
    fit04, rad, st, lt, torch = mods["fit04"], mods["radiosity"], mods["store"], mods["lt"], mods["torch"]
    if tuple(fit04.BASES) != LIGHTS:
        raise ValueError(f"04_fit.BASES is {fit04.BASES}, not {LIGHTS}")
    started = time.time()
    store, probes, pt, occ = st.Store(), st.Probes(), rad.load_patches(), lt.load_occ()
    nb = len(LIGHTS)
    Pdir = fit04.patch_direct_capture(pt, occ)
    F = rad.form_factors(pt["P"], pt["N"], pt["A"], pt["opening"])
    fs = fit04.build_fit_set(store)
    V, vid, w = fs["V"], fs["vid"], fs["w"]
    wsum = np.bincount(vid, w, V); ncount = np.bincount(vid, minlength=V)
    Cv = np.stack([np.bincount(vid, w * fs["C"][:, c], V) for c in range(3)], 1) / np.maximum(wsum, 1e-9)[:, None]
    Dv = np.zeros((V, nb))
    for a in range(0, len(fs["idx"]), 200_000):
        D = fit04.direct(store, fs["idx"][a:a + 200_000])
        for j in range(nb):
            Dv[:, j] += np.bincount(vid[a:a + 200_000], w[a:a + 200_000] * D[:, j], V)
    Dv /= np.maximum(wsum, 1e-9)[:, None]
    ok = (ncount >= 12) & (Cv.min(1) > 0.004) & (Cv.max(1) < 0.97)
    okv = np.where(ok)[0]; g_ok = fs["vgroup"][okv]
    ng = np.bincount(g_ok, minlength=k.groups)
    data = VoxelData(Dv_ok=Dv[okv], Iv_ok=None, logC=np.log(Cv[okv]), g_ok=g_ok, wg=1.0 / np.sqrt(ng[g_ok]), C=Cv[okv])
    sub = np.arange(0, len(fs["idx"]), 3)
    S_idx, S_patch = fit04.patch_samples(store, pt)
    log(f"refit-house {model.name}: voxels {dict(zip(fit04.GROUPS, ng.tolist()))}, {len(S_idx)} albedo samples, "
        f"{time.time() - started:.0f} s")
    x = initial_x(model, data.Dv_ok, k)
    rho = np.full((len(pt["P"]), 3), 0.35, np.float32); rho[pt["opening"]] = 0.0
    history, sol = [], None
    for it in range(4):
        B = rad.radiosity(F, rho, Pdir)
        Iprobe = rad.probe_indirect(probes.P[probes.kp], pt, B)
        Iflat = Iprobe.reshape(len(probes.kp), nb * 3, 6)
        Iv = np.zeros((V, nb * 3))
        for a in range(0, len(sub), 25_000):
            jj = sub[a:a + 25_000]; ii = fs["idx"][jj]
            n, iso = store.normals(ii)
            I = st.eval_cubes(probes, Iflat, store.pos[ii], n, iso)
            for j in range(nb * 3):
                Iv[:, j] += np.bincount(vid[jj], w[jj] * I[:, j], V)
        Iv /= np.maximum(np.bincount(vid[sub], w[sub], V), 1e-9)[:, None]
        data.Iv_ok = Iv[okv].reshape(len(okv), nb, 3)
        if it == 0:
            x = anchor_albedo(model, x, data, k)
        sol = solve(model, x, data, k)
        x = sol.x
        wts, cols, mu, gam = unpack(model, x, k)
        Wc = (wts[:, None] * cols).astype(np.float32)
        Imix = torch.einsum("pbcd,bc->pcd", Iprobe, torch.from_numpy(Wc))
        Es = fit04.E_capture_at(store, probes, S_idx, Wc, Imix)
        alb = np.clip(store.colour(S_idx) ** (1.0 / gam) / np.maximum(Es, 1e-6), 0, 1)
        sums = np.stack([np.bincount(S_patch, alb[:, c], len(pt["P"])) for c in range(3)], 1)
        cnts = np.bincount(S_patch, minlength=len(pt["P"]))
        rho_new = sums / np.maximum(cnts, 1)[:, None]
        rho_new[cnts <= 5] = np.median(rho_new[cnts > 5], 0)
        rho_new[pt["opening"]] = 0.0
        rho = np.clip(rho_new, 0.01, 0.9).astype(np.float32)
        rec = dict(iter=it, cost=round(float(sol.cost), 5), dataCost=data_cost(model, x, data, k), nfev=int(sol.nfev),
                   gamma=round(gam, 4), weights={b: float(f"{v:.5g}") for b, v in zip(LIGHTS, wts)},
                   col_day=cols[0].round(3).tolist(), col_cove=cols[6].round(3).tolist(), col_house=cols[7].round(3).tolist(),
                   col_dome=cols[9].round(3).tolist(), group_albedo_mean=dict(zip(fit04.GROUPS, np.exp(mu).round(3).tolist())),
                   patch_rho_median=np.median(rho[~pt["opening"]], 0).round(3).tolist())
        history.append(rec)
        log(json.dumps(rec) + f" {time.time() - started:.0f} s")
    E, mu, gam = model_light(model, x, data.Dv_ok, data.Iv_ok, k)
    wts, cols, _mu, _gam = unpack(model, x, k)
    spread, budget = {}, {}
    for gi, gname in enumerate(fit04.GROUPS):
        m = data.g_ok == gi
        lc = np.log2(data.C[m]); la = lc - gam * np.log2(np.maximum(E[m], 1e-9))
        lum_c = np.log2(data.C[m] @ st.LUMW); lum_a = lum_c - gam * np.log2(np.maximum(E[m] @ st.LUMW, 1e-9))
        spread[gname] = dict(voxels=int(m.sum()), sd_log2_captured_lum=round(float(np.std(lum_c)), 3),
                             sd_log2_albedo_lum=round(float(np.std(lum_a)), 3), sd_log2_captured_rgb=np.std(lc, 0).round(3).tolist(),
                             sd_log2_albedo_rgb=np.std(la, 0).round(3).tolist())
        contrib = ((data.Dv_ok[m][:, :, None] + data.Iv_ok[m]) * (wts[:, None] * cols)[None]) @ st.LUMW
        ind = (data.Iv_ok[m] * (wts[:, None] * cols)[None]) @ st.LUMW
        budget[gname] = dict(zip(LIGHTS, (contrib.sum(0) / contrib.sum()).round(3).tolist()))
        budget[gname]["indirect_share"] = round(float(ind.sum() / contrib.sum()), 3)
    B = rad.radiosity(F, rho, Pdir)
    Iprobe = rad.probe_indirect(probes.P[probes.kp], pt, B)
    Wc = (wts[:, None] * cols).astype(np.float32)
    os.makedirs(out_dir, exist_ok=True)
    if write_ecap:
        Imix = torch.einsum("pbcd,bc->pcd", Iprobe, torch.from_numpy(Wc))
        part = os.path.join(out_dir, "E_cap.npy.part")
        out = np.lib.format.open_memmap(part, mode="w+", dtype=np.float32, shape=(store.N, 3))
        for sl in store.chunks(200_000):
            n, iso = store.normals(sl)
            out[sl] = fit04.direct(store, sl) @ Wc + st.eval_cubes(probes, Imix, store.pos[sl], n, iso)
        out.flush(); del out
        os.replace(part, os.path.join(out_dir, "E_cap.npy"))
    np.savez(os.path.join(out_dir, "fit_state.npz"), rho=rho, Pdir_cap=Pdir, weights=wts, cols=cols, Wc=Wc, gamma=np.array(gam))
    fit = {"bases": list(LIGHTS), "weights": wts.tolist(), "colours": cols.tolist(), "sky_weights_capture": np.asarray(fit04.SKY_W).tolist(),
           "gamma": gam, "groups": list(fit04.GROUPS), "group_albedo_mean": np.exp(mu).tolist(), "paint_albedo_green": k.paint_albedo,
           "history": history, "spread": spread, "budget": budget, "model": model.describe(x)}
    with open(os.path.join(out_dir, "fit.json"), "w", encoding="utf-8") as f:
        json.dump(fit, f, indent=1, allow_nan=False)
    report = {"model": model.name, "dataCost": history[-1]["dataCost"], "cost": float(sol.cost), "weights": wts.tolist(),
              "colours": cols.tolist(), "gamma": gam, "describe": model.describe(x)}
    if isinstance(model, RefitModel):
        report["logPerBulb"] = float(x[8])
    return report


def bulb_shares(bulbs, counts: LampCounts, report, fit_sha256) -> dict:
    """bulb-intensities.json for R1d's Task 3: every lamp of the table ("high" and "medium") with its kind and its
    intensity per unit of its group's weight (phi over the group's weight: 1 / the mean end-chandelier lamp count for
    ch_end, 1 / (the centre's candles + w_crown x its crown tubes) for ch_centre, and a crown tube w_crown x a candle's),
    the w_crown used, and the refit's group shares (each chandelier's share of its group's lamps). The entries that are
    not lamps ("low" and "exclude") are named only in fit.notLamps: with bulbs they name every id of the table once."""
    per_unit = {"ch_end": 1.0 / counts.end_mean, "ch_centre": 1.0 / counts.centre}
    group_of = lambda bid: "ch_centre" if int(bid.split("_")[0][1:]) == CENTRE else "ch_end"
    values = {bid: {"kind": kind, "intensity": per_unit[group_of(bid)] * (counts.w_crown if kind == CROWN else 1.0)}
              for bid, kind in bulbs["kinds"].items()}
    ends_total = sum(bulbs["counts"][c] for c in ENDS)
    groups = {"ch_end": {"source": 6, "weight": report["weights"][7], "perBulbPerUnitWeight": per_unit["ch_end"],
                         "chandeliers": {str(c): {"lamps": bulbs["counts"][c], "share": bulbs["counts"][c] / ends_total} for c in ENDS}},
              "ch_centre": {"source": 7, "weight": report["weights"][8], "perBulbPerUnitWeight": per_unit["ch_centre"],
                            "crownPerUnitWeight": per_unit["ch_centre"] * counts.w_crown,
                            "chandeliers": {str(CENTRE): {"lamps": bulbs["counts"][CENTRE], "candles": bulbs["candles"][CENTRE],
                                                          "crowns": len(bulbs["crowns"]), "share": 1.0}}}}
    return {"schema": SHARES_SCHEMA, "wCrown": counts.w_crown, "bulbs": dict(sorted(values.items())),
            "fit": {"model": "one per-bulb intensity for every chandelier candle, w_crown of it for a crown tube (T-639 R1a Task 4b)",
                    "perBulbIntensity": math.exp(report["logPerBulb"]), "lampRatio": counts.ratio, "groups": groups,
                    "crownWeightMeasured": bulbs["crownWeight"], "rangeBalance": bulbs["rangeBalance"], "notLamps": bulbs["notLamps"],
                    "blobBalance": bulbs["blobBalance"], "tableSha256": bulbs["sha256"], "fitJsonSha256": fit_sha256}}


def accept_fit(proof, refit, counts: LampCounts) -> dict:
    residual = refit["dataCost"] / proof["dataCost"]
    w = refit["weights"]
    ratio = w[8] / w[7] if w[7] > 0 else math.inf
    lp = refit["logPerBulb"]
    out = {"dataCostProof": proof["dataCost"], "dataCostRefit": refit["dataCost"], "residualRatio": residual,
           "residualPass": bool(residual <= 1.0 + RESIDUAL_TOLERANCE), "centreOverEnd": ratio, "lampRatio": counts.ratio,
           "ratioPass": bool(abs(ratio / counts.ratio - 1.0) <= RATIO_TOLERANCE), "logPerBulb": lp,
           "boundPass": bool(LOG_BOUNDS[0] + BOUND_MARGIN < lp < LOG_BOUNDS[1] - BOUND_MARGIN)}
    out["pass"] = out["residualPass"] and out["ratioPass"] and out["boundPass"]
    return out


def photo_gate(baseline, refit) -> dict:
    """07_compare's house-light metrics at the night stations, the refit's against the proof fit's: no worse."""
    views, ok = {}, True
    for view in PHOTO_VIEWS:
        b, r = baseline[view][PHOTO_JOB], refit[view][PHOTO_JOB]
        row = {"rBaseline": b["r"], "rRefit": r["r"], "maeBaseline": b["mae_affine_stops"], "maeRefit": r["mae_affine_stops"],
               "chromaBaseline": b["chroma_mae_rg_bg"], "chromaRefit": r["chroma_mae_rg_bg"]}
        row["pass"] = bool(r["r"] >= b["r"] - PHOTO_R_SLACK and r["mae_affine_stops"] <= b["mae_affine_stops"] + PHOTO_STOPS_SLACK
                           and all(rc <= bc + PHOTO_STOPS_SLACK for rc, bc in zip(r["chroma_mae_rg_bg"], b["chroma_mae_rg_bg"])))
        ok &= row["pass"]
        views[view] = row
    return {"job": PHOTO_JOB, "views": views, "slack": {"r": PHOTO_R_SLACK, "stops": PHOTO_STOPS_SLACK}, "pass": bool(ok)}


def variant_tag(w_crown) -> str:
    """The refit folder of a sensitivity run at w_crown: refit-wcrown-0, refit-wcrown-1."""
    return f"{DEFAULT_TAG}-wcrown-{float(w_crown):g}"


def photo_values(metrics) -> dict:
    """07_compare's house-light metrics at the night stations: {view: {r, mae_affine_stops, chroma_rg, chroma_bg}}."""
    out = {}
    for view in PHOTO_VIEWS:
        m = metrics[view][PHOTO_JOB]
        out[view] = {"r": m["r"], "mae_affine_stops": m["mae_affine_stops"],
                     "chroma_rg": m["chroma_mae_rg_bg"][0], "chroma_bg": m["chroma_mae_rg_bg"][1]}
    return out


def photo_noise(first, repeat) -> dict:
    """Each metric's run-to-run noise: its difference between two renders of the same multipliers, never below the
    metrics' rounding."""
    a, b = photo_values(first), photo_values(repeat)
    return {view: {key: max(abs(a[view][key] - b[view][key]), METRIC_ROUNDING) for key, _sign in PHOTO_METRICS}
            for view in PHOTO_VIEWS}


def clearly_better(x, y, noise) -> bool:
    """Every metric at both night stations better in x than in y by more than its noise (r higher, the stops lower)."""
    return all(sign * (x[view][key] - y[view][key]) > noise[view][key] for view in PHOTO_VIEWS for key, sign in PHOTO_METRICS)


def crown_sensitivity(runs, repeat) -> dict:
    """The refit at the measured w_crown and at both ends (ruling L2). runs maps DEFAULT_TAG and both variant tags to
    {wCrown, dataCost, budget (fit.json's), photo (07_compare's metrics.json)}; repeat is a second render of the default's
    multipliers, which gives each metric's run-to-run noise. The night photographs clearly prefer an end when every metric
    there beats the other end's by more than its noise: then the task stops and reports instead of choosing."""
    noise = photo_noise(runs[DEFAULT_TAG]["photo"], repeat)
    rows = {tag: {"wCrown": r["wCrown"], "dataCost": r["dataCost"],
                  "chCentreShare": {g: r["budget"][g]["ch_centre"] for g in ("floor", "ceiling")},
                  "photo": photo_values(r["photo"])} for tag, r in runs.items()}
    low, high = (rows[variant_tag(w)]["photo"] for w in CROWN_ENDS)
    preferred = CROWN_ENDS[0] if clearly_better(low, high, noise) else CROWN_ENDS[1] if clearly_better(high, low, noise) else None
    return {"runs": rows, "noise": noise, "metricRounding": METRIC_ROUNDING, "preferredEnd": preferred,
            "pass": preferred is None}


def same_run(dir_a, dir_b) -> list:
    """The names of the files that differ between two runs' folders: .npz array by array (keys, dtype, shape, bytes),
    every other file byte by byte; a file present in one folder only differs."""
    differ = []
    for name in sorted(set(os.listdir(dir_a)) | set(os.listdir(dir_b))):
        pa, pb = os.path.join(dir_a, name), os.path.join(dir_b, name)
        if not (os.path.isfile(pa) and os.path.isfile(pb)):
            differ.append(name)
            continue
        if name.endswith(".npz"):
            with np.load(pa) as za, np.load(pb) as zb:
                same = sorted(za.files) == sorted(zb.files) and all(
                    za[key].dtype == zb[key].dtype and za[key].shape == zb[key].shape and za[key].tobytes() == zb[key].tobytes()
                    for key in za.files)
        else:
            with open(pa, "rb") as fa, open(pb, "rb") as fb:
                same = fa.read() == fb.read()
        if not same:
            differ.append(name)
    return differ


def copy_verified(src, dst) -> str:
    """src copied to dst through a partial file renamed over it; returns the SHA-256, checked equal at both ends."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    part = dst + ".part"
    shutil.copyfile(src, part)
    os.replace(part, dst)
    digest = sha256_file(dst)
    if digest != sha256_file(src):
        raise OSError(f"{dst}: the copied bytes differ from {src}")
    return digest


def snapshot_fit(work) -> dict:
    """The work's capture fit (FIT_FILES) kept once in <work>/fit-proof/. An existing snapshot must equal the files it
    would copy, unless the work's fit.json is already the refit (then the snapshot stands as it is); never overwritten."""
    with open(os.path.join(work, "fit.json"), encoding="utf-8") as f:
        refitted = (json.load(f).get("model") or {}).get("name") == "refit"
    out = {}
    for name in FIT_FILES:
        src, dst = os.path.join(work, name), os.path.join(work, SNAPSHOT, name)
        if os.path.exists(dst):
            if not refitted and sha256_file(dst) != sha256_file(src):
                raise ValueError(f"{dst} exists and differs from {src}: the snapshot of the proof fit is never overwritten")
            out[name] = sha256_file(dst)
        elif refitted:
            raise ValueError(f"{work} holds the refit but no snapshot of the proof fit")
        else:
            out[name] = copy_verified(src, dst)
    return out
