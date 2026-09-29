# The Restored Hall — R1a "The light bake" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reproducible offline tool, `tools/relight`, turns the Grand Hall's served splats and the 29 September light model into an immutable relight package (light records for all 24 served tiles, per-source bounce probes, window stencils, floor light maps, the fitted capture light and evidence) and publishes the restored floor as floor skin v2, each checked against the proof that was compared with the hall's photographs.

**Architecture:** The proof's verified research scripts move into the repo unchanged except for where they read and write (Task 2). Small new modules build on their per-splat tables: a byte codec and the package contract (Task 1), window stencils and flags (Task 3), bounce probes and floor light maps (Task 4), per-tile records with a transfer to the coarser levels plus a numpy reference of the browser's multiplier (Task 5), and the restored floor (Task 6). `docs/engineering/relight-package.md` is the contract that plan R1b (the browser) consumes. Spec: `docs/superpowers/specs/2026-09-29-the-restored-hall-design.md` (§4.1, §4.2, §6, §8).

**Tech Stack:** Python 3.13 (`C:/Python313/python.exe`) with numpy 2.4, torch 2.9 + CUDA (RTX 4090), scipy 1.17 (`cKDTree`), Pillow 12 and OpenCV 5; `unittest` (no new dependencies); the repo's publisher `packages/api/src/scripts/publish-splat-tiles.ts --package` (pnpm 9.15.4, Node 22).

## Global Constraints

- Work only in the worktree `D:/claude/real-hall/repo`, branch `claude/real-hall`. Never edit `C:/Users/blake/omnitwin2`.
- Commit with explicit pathspecs only; inspect `git diff --cached --stat` before each commit; every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Inputs are read-only: the staged tiles `D:/claude/splats/trades-hall/grand-hall/*.sog`, `D:/claude/splat-quality-20260923/**`, the proof `D:/claude/real-hall/renovation/**`, and `F:/**`.
- Outputs: work tables in `D:/claude/relight/grand-hall/work/`, the package in `D:/claude/splats/trades-hall/grand-hall/relight/v1/` (development serves this root through `SPLAT_STAGING_ROOT`), evidence in `D:/claude/relight/grand-hall/evidence/`. Nothing bulky goes on C:; C: filled up twice on 29 September.
- GPU rule: every step that runs torch on CUDA holds `D:/claude/visual-firstprinciples-20260928/gpu.lock`, a JSON file `{"owner":"relight-bake <step>","since":"<ISO time>"}` created exclusively and deleted afterwards. If another owner holds it (the T-640 performance session uses it), wait. One GPU job at a time; the PC lost power twice under concurrent GPU load. The proof's code (`lt.py`, `radiosity.py` and the moved scripts) runs torch on the CPU, with no CUDA anywhere, so it never takes the lock (corrected 29 September after the first run held the lock through CPU work).
- Memory rule: per-splat work runs in chunks of at most 500,000 splats, as the proof does. The PC's 32 GB are shared with other sessions.
- Spec numbers, verbatim: the light multiplier is clamped to between 1/16 and 8; the codec's round trip is within 1/20 of a stop; at the captured light the result is neutral; lamps default to 2,700 K. The night photo check (0.80 at station 45, 0.85 at station 43) is measured in R1b.
- Frames: `json` is the served tiles' frame (metres, z up). `e57` is the light model's frame: +x at bearing 14.3°, window wall at y = −10.329, outward normal −y. `T_JE` (json ← e57) comes from `canonical_frame.json`. The package describes the model in the e57 frame and gives `tileToModel` = `T_EJ` = inverse of `T_JE`.
- Unit tests: from `tools/relight`, `C:/Python313/python.exe -m unittest discover -s tests -v`. Unit tests never need the GPU or the D: inputs.
- Proof facts this plan must reproduce (from `D:/claude/real-hall/renovation/relight/work/`): 6,030,980 finest-level splats (the environment tile plus the 11 finest tiles, product order); `fit.json` weights and colours; lamp colour about (1.62, 1, 0.47), about 2,700–2,800 K; capture contrast γ = 1.

## The multiplier (normative)

R1b's GPU kernel implements exactly this; Task 5's `relight/reference.py` is its executable definition. Per splat, in the e57 frame:

- Inputs from the record: direct light `D[k]` for the nine sources k = W1..W5, cove, ch_end, ch_centre, dome; normal `n`; flags (class, isotropic, sun-reachable, chandelier group). From the splat itself: position `p` and captured linear colour `C` (the stored DC colour, sRGB-decoded); `L = C · (0.2126, 0.7152, 0.0722)`.
- Bounce light `I[k]` (RGB) = the per-source probe volume evaluated at `p` with normal `n`: trilinear over the eight grid corners with invalid corners dropped and the weights renormalised (the proof's `03_bases.trilinear_weights`), then the ambient-cube evaluation `E(n) = Σ axis n+² cube[+axis] + n−² cube[−axis]`, or the mean of the six faces for isotropic receivers (the proof's `lt.cube_eval`).
- Captured light: `Ecap = Σk w[k] c[k] ⊙ (D[k] + I[k])` with the fitted capture weights `w` and colours `c` from the manifest.
- Scenario light: `E = Σk s[k] ⊙ (D[k] + I[k])`, where `s[k]` is the setting's RGB weight for source k (R1b derives it from the presets), plus, when the sun is up, `sunRGB × V(p) × cosθ + Σw b[w] × sunRGB ⊙ I[w]`. `V` is the sum over the five windows of the two-plane visibility of Task 3 (only for sun-reachable splats), each window counted only while the sun's elevation exceeds that window's horizon at the sun's azimuth (`horizon[w][round(azimuth) mod 360]`, with azimuth `atan2(σ·east, σ·north)` in degrees and elevation `asin(σ·up)` from the manifest's `site`), times the glass transmission `fresnel(|σ · (0,−1,0)|)`. The sun-bounce weights use the same horizon test. `cosθ = max(0, n·σ)`, or 0.25 for isotropic receivers. `b[w]` is the sun-bounce weight of Task 4.
- Interior (class 0) and chandelier fixtures (class 6, lamps on): `M = clamp(E / max(Ecap, 1e-4), 1/16, 8)` per channel.
- Embrasure (class 1: curtains, glazing bars, reveals, columns): `ρ = min(C / Ecap, 0.8)`, `excess = max(C − ρ Ecap, 0)`, `rBack = skyLevel × skyRGB / c[W1]`, `M = clamp((ρ E + excess rBack) / max(C, 1e-4), 1/16, 8)`.
- Lamp emitters (class 3 chandelier bulbs, class 4 dome lamps, class 5 cove strip) and fixtures (class 6) at lamp level ℓ ∈ [0, 1] of their group: `Mlit = 1 + (β − 1) × smoothstep(0.45, 0.9, L)` for classes 3 and 4, where β is the setting's emitter boost: 1 at the captured setting, so the captured setting stays exactly neutral, and 4 for the proof's night with the lamps lit; `1` for class 5, and the interior rule for class 6. `Munlit = (A E) / max(C, 1e-4)` with `A = 0.5` for class 4, `0.3` for class 5, `0.35` otherwise, times `clip(C / max(L, 1e-4), 0.5, 2)^0.4` except for class 5. `M = clamp(ℓ Mlit + (1 − ℓ) Munlit, 0, 8)`.
- Hidden (class 2: outside the hall, the environment shell, pane haze): alpha 0.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `docs/engineering/relight-package.md` | Create | The package contract (read by R1b) |
| `tools/relight/README.md` | Create | How to run the bake and publish |
| `tools/relight/config/grand-hall.json` | Create | Every input path and room constant |
| `tools/relight/relight/__init__.py` | Create | Package marker |
| `tools/relight/relight/__main__.py` | Create | CLI: `proof`, `windows`, `check-stencils`, `probes`, `floor`, `records`, `check` |
| `tools/relight/relight/config.py` | Create | Load and validate the config |
| `tools/relight/relight/gpulock.py` | Create | The shared GPU lock |
| `tools/relight/relight/codec.py` | Create | Log codes, octahedral normals, flags, records, multiplier packing |
| `tools/relight/relight/windows.py` | Create | Two-plane stencils, visibility, horizons, Fresnel table, sun reach |
| `tools/relight/relight/probes.py` | Create | Per-source bounce probes, sun-bounce weights |
| `tools/relight/relight/floorlight.py` | Create | Floor light maps on the floor-skin grid |
| `tools/relight/relight/records.py` | Create | Finest-level records, transfer to coarser levels |
| `tools/relight/relight/reference.py` | Create | The normative multiplier in numpy |
| `tools/relight/relight/package.py` | Create | Write tiles, probes, stencils, maps, manifest, checksums |
| `tools/relight/proof/*.py` | Create (moved) | The proof's scripts, paths from the config only |
| `tools/relight/tests/test_*.py` | Create | Unit tests |
| `tools/floor-skin/build_floor_skin.py`, `tools/floor-skin/README.md` | Modify | Arm R (restored albedo) with luminance calibration |
| `packages/web/src/lib/relight/__fixtures__/relight-vectors.json` | Create | Test vectors for R1b |
| The day's session log under `docs/sessions/`, `docs/state/tasks.md` | Modify | Record the bake |

---

### Task 0: Baseline

**Files:** none.

- [ ] **Step 1: Check the branch and the inputs**

Run:

```bash
cd D:/claude/real-hall/repo && git status --short && git log --oneline -1
C:/Python313/python.exe -c "import numpy, torch, scipy, PIL, cv2; print(numpy.__version__, torch.__version__, torch.cuda.is_available(), scipy.__version__)"
ls D:/claude/splats/trades-hall/grand-hall/*.sog | wc -l
ls D:/claude/splat-quality-20260923/canonical-frame-court/canonical_frame.json D:/claude/splat-quality-20260923/weather-daylight/horizon.json D:/claude/real-hall/renovation/relight/work/fit.json
```

Expected: clean tree; numpy 2.4.x, torch 2.9.x, `True`; 24 tiles; the three files exist.

- [ ] **Step 2: Check space**

Run: `powershell -NoProfile -Command "'C GB ' + [math]::Round((Get-PSDrive C).Free/1GB) + ' D GB ' + [math]::Round((Get-PSDrive D).Free/1GB)"`
Expected: D: has at least 200 GB free. If C: has under 20 GB, tell the controller before any GPU step: the pagefile lives on C:.

### Task 1: The package contract and the codec

**Files:**
- Create: `docs/engineering/relight-package.md`, `tools/relight/relight/__init__.py`, `tools/relight/relight/codec.py`, `tools/relight/tests/__init__.py`, `tools/relight/tests/test_codec.py`

**Interfaces:**
- Produces: `codec.SOURCES`, `codec.RECORD_BYTES = 12`, `encode_log(values, lo, hi) -> uint8`, `decode_log(codes, lo, hi) -> float64`, `source_range(values) -> (lo, hi)`, `encode_octahedral((N,3)) -> (N,2) uint8`, `decode_octahedral((N,2)) -> (N,3)`, `pack_records(direct (N,9), normals (N,3), flags (N,), ranges) -> bytes`, `unpack_records(buf, ranges) -> (direct, normals, flags)`, `pack_multiplier(rgb (N,3), alpha (N,)) -> (N,) uint32`, `unpack_multiplier(words) -> (rgb, alpha)`, and the class and flag constants.

- [ ] **Step 1: Write the failing tests**

`tools/relight/tests/__init__.py` is empty. `tools/relight/tests/test_codec.py`:

```python
import unittest
import numpy as np
from relight import codec


class LogCodes(unittest.TestCase):
    def test_round_trip_within_a_twentieth_of_a_stop(self):
        rng = np.random.default_rng(1)
        lo, hi = -20.0, 5.0
        v = np.exp2(rng.uniform(lo, hi, 100_000))
        back = codec.decode_log(codec.encode_log(v, lo, hi), lo, hi)
        self.assertLessEqual(float(np.abs(np.log2(back) - np.log2(v)).max()), 0.05)

    def test_zero_is_code_zero_and_decodes_to_zero(self):
        c = codec.encode_log(np.array([0.0, -1.0, 1e-30]), -25.0, 0.0)
        self.assertEqual(c.tolist(), [0, 0, 1])
        self.assertEqual(codec.decode_log(np.array([0]), -25.0, 0.0).tolist(), [0.0])

    def test_source_range_spans_25_stops_below_the_maximum(self):
        lo, hi = codec.source_range(np.array([0.0, 0.3, 5.0]))
        self.assertEqual((lo, hi), (-22.0, 3.0))

    def test_empty_source_has_a_valid_range(self):
        self.assertEqual(codec.source_range(np.zeros(4)), (-25.0, 0.0))


class Normals(unittest.TestCase):
    def test_octahedral_round_trip_within_two_degrees(self):
        rng = np.random.default_rng(2)
        n = rng.normal(size=(50_000, 3)); n /= np.linalg.norm(n, axis=1, keepdims=True)
        back = codec.decode_octahedral(codec.encode_octahedral(n))
        ang = np.degrees(np.arccos(np.clip((n * back).sum(1), -1, 1)))
        self.assertLessEqual(float(ang.max()), 2.0)

    def test_axis_normals_are_exact_enough(self):
        n = np.array([[0, 0, 1.0], [0, 0, -1.0], [1.0, 0, 0], [0, -1.0, 0]])
        back = codec.decode_octahedral(codec.encode_octahedral(n))
        self.assertTrue(np.allclose(back, n, atol=0.01))


class Records(unittest.TestCase):
    def test_records_round_trip(self):
        rng = np.random.default_rng(3)
        direct = np.exp2(rng.uniform(-10, 2, size=(1000, 9))); direct[::7, 3] = 0.0
        normals = rng.normal(size=(1000, 3)); normals /= np.linalg.norm(normals, axis=1, keepdims=True)
        flags = rng.integers(0, 256, 1000).astype(np.uint8)
        ranges = [codec.source_range(direct[:, k]) for k in range(9)]
        buf = codec.pack_records(direct, normals, flags, ranges)
        self.assertEqual(len(buf), 1000 * codec.RECORD_BYTES)
        d2, n2, f2 = codec.unpack_records(buf, ranges)
        ok = direct > 0
        self.assertTrue(np.array_equal(d2 == 0, ~ok))
        self.assertLessEqual(float(np.abs(np.log2(d2[ok]) - np.log2(direct[ok])).max()), 0.05)
        self.assertTrue(np.array_equal(f2, flags))

    def test_flags_layout(self):
        self.assertEqual(codec.CLASS_MASK, 0b111)
        self.assertEqual((codec.FLAG_ISO, codec.FLAG_SUN, codec.FLAG_CH_CENTRE), (8, 16, 32))


class Multipliers(unittest.TestCase):
    def test_multiplier_words_round_trip(self):
        rgb = np.array([[1.0, 0.5, 8.0], [1 / 16, 2.0, 0.0], [3.0, 3.0, 3.0]])
        alpha = np.array([1.0, 1.0, 0.0])
        words = codec.pack_multiplier(rgb, alpha)
        self.assertEqual(words.dtype, np.uint32)
        back, a = codec.unpack_multiplier(words)
        nz = rgb > 0
        self.assertLessEqual(float(np.abs(np.log2(back[nz]) - np.log2(rgb[nz])).max()), 0.05)
        self.assertEqual(float(back[1, 2]), 0.0)
        self.assertEqual(a.tolist(), [1.0, 1.0, 0.0])

    def test_multipliers_are_clamped_to_the_spec_range(self):
        back, _ = codec.unpack_multiplier(codec.pack_multiplier(np.array([[100.0, 1e-9, 1.0]]), np.array([1.0])))
        self.assertAlmostEqual(float(back[0, 0]), 8.0, places=6)
        self.assertAlmostEqual(float(back[0, 1]), 1 / 16, places=6)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest discover -s tests -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'relight'` (or `codec`).

- [ ] **Step 3: Write the codec**

`tools/relight/relight/__init__.py`:

```python
"""Offline light bake for the Restored Hall (T-639 R1a)."""
```

`tools/relight/relight/codec.py`:

```python
"""Byte codec of the relight package (docs/engineering/relight-package.md).

A record is 12 bytes per splat: nine log-coded direct-light values (one per source,
in SOURCES order), an octahedral normal (2 bytes) and a flags byte. A log code is 0 for
zero and 1..255 for 2**lo .. 2**hi, evenly spaced in log2.
"""
from __future__ import annotations

import numpy as np

SOURCES = ("W1", "W2", "W3", "W4", "W5", "cove", "ch_end", "ch_centre", "dome")
RECORD_BYTES = 12
LOG_STEPS = 254
SOURCE_SPAN_STOPS = 25.0

CLASS_MASK = 0b0000_0111
CLASS_INTERIOR = 0
CLASS_EMBRASURE = 1
CLASS_HIDDEN = 2
CLASS_CH_EMITTER = 3
CLASS_DOME_EMITTER = 4
CLASS_COVE = 5
CLASS_CH_FIXTURE = 6
FLAG_ISO = 1 << 3
FLAG_SUN = 1 << 4
FLAG_CH_CENTRE = 1 << 5

MULT_LO, MULT_HI = -4.0, 3.0   # 1/16 .. 8, the spec's clamp


def encode_log(values, lo: float, hi: float) -> np.ndarray:
    if not hi > lo:
        raise ValueError("hi must exceed lo")
    v = np.asarray(values, dtype=np.float64)
    out = np.zeros(v.shape, dtype=np.uint8)
    pos = v > 0
    t = (np.log2(np.where(pos, v, 1.0)) - lo) / (hi - lo)
    code = 1 + np.rint(np.clip(t, 0.0, 1.0) * LOG_STEPS)
    out[pos] = code[pos].astype(np.uint8)
    return out


def decode_log(codes, lo: float, hi: float) -> np.ndarray:
    c = np.asarray(codes, dtype=np.float64)
    return np.where(c > 0, np.exp2(lo + (c - 1.0) * (hi - lo) / LOG_STEPS), 0.0)


def source_range(values) -> tuple[float, float]:
    v = np.asarray(values, dtype=np.float64)
    v = v[v > 0]
    if v.size == 0:
        return (-SOURCE_SPAN_STOPS, 0.0)
    hi = float(np.ceil(np.log2(v.max())))
    return (hi - SOURCE_SPAN_STOPS, hi)


def _sgn(a: np.ndarray) -> np.ndarray:
    return np.where(a >= 0.0, 1.0, -1.0)


def encode_octahedral(normals) -> np.ndarray:
    n = np.asarray(normals, dtype=np.float64)
    n = n / np.maximum(np.abs(n).sum(axis=1, keepdims=True), 1e-12)
    x, y, z = n[:, 0], n[:, 1], n[:, 2]
    u = np.where(z >= 0, x, (1.0 - np.abs(y)) * _sgn(x))
    v = np.where(z >= 0, y, (1.0 - np.abs(x)) * _sgn(y))
    return np.stack([np.rint((u * 0.5 + 0.5) * 255.0), np.rint((v * 0.5 + 0.5) * 255.0)], axis=1).astype(np.uint8)


def decode_octahedral(codes) -> np.ndarray:
    c = np.asarray(codes, dtype=np.float64) / 255.0 * 2.0 - 1.0
    u, v = c[:, 0], c[:, 1]
    z = 1.0 - np.abs(u) - np.abs(v)
    x = np.where(z < 0, (1.0 - np.abs(v)) * _sgn(u), u)
    y = np.where(z < 0, (1.0 - np.abs(u)) * _sgn(v), v)
    n = np.stack([x, y, z], axis=1)
    return n / np.linalg.norm(n, axis=1, keepdims=True)


def pack_records(direct, normals, flags, ranges) -> bytes:
    d = np.asarray(direct, dtype=np.float64)
    if d.ndim != 2 or d.shape[1] != len(SOURCES) or len(ranges) != len(SOURCES):
        raise ValueError("direct light must be (N, 9) with nine ranges")
    rec = np.empty((d.shape[0], RECORD_BYTES), dtype=np.uint8)
    for k, (lo, hi) in enumerate(ranges):
        rec[:, k] = encode_log(d[:, k], lo, hi)
    rec[:, 9:11] = encode_octahedral(normals)
    rec[:, 11] = np.asarray(flags, dtype=np.uint8)
    return rec.tobytes()


def unpack_records(buf, ranges):
    rec = np.frombuffer(buf, dtype=np.uint8).reshape(-1, RECORD_BYTES)
    direct = np.stack([decode_log(rec[:, k], *ranges[k]) for k in range(len(SOURCES))], axis=1)
    return direct, decode_octahedral(rec[:, 9:11]), rec[:, 11].copy()


def pack_multiplier(rgb, alpha) -> np.ndarray:
    m = np.clip(np.asarray(rgb, dtype=np.float64), 0.0, 2.0 ** MULT_HI)
    m = np.where(m > 0, np.maximum(m, 2.0 ** MULT_LO), 0.0)
    codes = encode_log(m, MULT_LO, MULT_HI).astype(np.uint32)
    a = np.rint(np.clip(np.asarray(alpha, dtype=np.float64), 0.0, 1.0) * 255.0).astype(np.uint32)
    return codes[:, 0] | (codes[:, 1] << 8) | (codes[:, 2] << 16) | (a << 24)


def unpack_multiplier(words):
    w = np.asarray(words, dtype=np.uint32)
    codes = np.stack([(w >> s) & 0xFF for s in (0, 8, 16)], axis=1)
    return decode_log(codes, MULT_LO, MULT_HI), ((w >> 24) & 0xFF) / 255.0
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest discover -s tests -v`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write the contract**

`docs/engineering/relight-package.md`:

````markdown
# The relight package (venviewer.relight.v1)

Built offline by `tools/relight` (plan R1a) and read by the browser (plan R1b). One package per served splat model,
immutable once published: `splats/<venue>/<room>/relight/v<N>/`. Spec: `docs/superpowers/specs/2026-09-29-the-restored-hall-design.md`.

## Files

| Path | Content |
|---|---|
| `manifest.json` | Everything below, plus a SHA-256 for every other file |
| `tiles/<tile stem>.relight.gz` | gzip of `count × 12` bytes, one record per splat in the tile's own order |
| `probes.bin.gz` | gzip of float16 little-endian `[probe][source 0..8][channel r,g,b][face +x,−x,+y,−y,+z,−z]` |
| `probe-valid.bin.gz` | gzip of one byte per probe: 1 valid, 0 invalid (outside the hall) |
| `windows/<id>-glass.png`, `windows/<id>-inner.png` | 8-bit transmittance stencils, row 0 at the top of the opening |
| `floor/light-0.png` … `light-2.png` | RGBA8 log-coded direct light of the nine sources on the floor grid (0: W1–W4, 1: W5, cove, ch_end, ch_centre, 2: dome, unused ×3) |

## Record (12 bytes per splat)

| Bytes | Meaning |
|---|---|
| 0–8 | Direct light of W1, W2, W3, W4, W5, cove, ch_end, ch_centre, dome: log code, 0 = zero, 1..255 = `2^(lo + (code − 1)(hi − lo)/254)` with the source's `lo`, `hi` from `encoding.sources` |
| 9–10 | Surface normal in the model frame, octahedral: `u = byte9/255·2 − 1`, `v = byte10/255·2 − 1` |
| 11 | Flags: bits 0–2 class (0 interior, 1 embrasure, 2 hidden, 3 chandelier bulb, 4 dome lamp, 5 cove strip, 6 chandelier fixture); bit 3 isotropic receiver; bit 4 reachable by the sun; bit 5 chandelier group centre (else end) |

## Manifest (fields)

- `schema`: `"venviewer.relight.v1"`; `room`; `createdAt`; `tool` (the repo commit that built it).
- `model`: `{ frame: "e57", tileToModel: 4×4 row-major }`.
- `site`: `{ latitude, longitude, north: [x,y,z], east: [x,y,z], up: [0,0,1] }` in the model frame.
- `sources`: the nine names in record order.
- `encoding`: `{ record: 12, sources: [[lo, hi] × 9], floor: [[lo, hi] × 9], multiplier: { lo: -4, hi: 3 } }`.
- `capture`: `{ weights: [9], colours: [[r,g,b] × 9], daylightColour: [r,g,b], skyBandWeights: [0.15, 0.66, 1.0, 1.21], gamma: 1 }`.
- `lamps`: `{ measuredColour: [r,g,b], cct: number, groups: { cove: 5, ch_end: 6, ch_centre: 7, dome: 8 } }` (the source index of each lamp group).
- `sun`: `{ bounce: { beta: number, skyFlux: [5] }, fresnel: [101 values for |cos| 0.00..1.00] }`.
- `windows`: per window `{ id, glassDepth, outline: { x0, x1, sill, top, kind }, planes: { inner: Plane, glass: Plane }, horizon: [360 elevations in degrees, by azimuth 0..359] }`, where `Plane = { origin, u, v, width, height, normal, stencil, stencilSize: [w, h] }` in the model frame.
- `probes`: `{ origin: [x,y,z], spacing: number, shape: [nx, ny, nz], file, validFile }` (axis-aligned in the model frame).
- `floor`: `{ skin: "floor-skin/v2", texelToModel: 4×4 row-major, texel: 0.05, size: [w, h], files: [3] }`.
- `tiles`: `[{ tile, tileSha256, level, count, file, sha256, bytes }]` for every served tile.
- `presetsFromProof`: the three proof scenarios' settings (night, sunny morning 31 May 09:00 BST, overcast noon), as `05_relight.SCENARIOS` defines them.
- `evidence`: `{ capturedIdentity, proofRegression, transfer, determinism, stencilSun, sunBounce }`.
- `files`: `{ <path>: { sha256, bytes } }` for every file except the manifest.

## The multiplier

Normative text: `docs/superpowers/plans/2026-09-29-restored-hall-r1a-light-bake.md`, section "The multiplier".
Executable definition: `tools/relight/relight/reference.py`. The browser packs it per splat as a 32-bit word:
bits 0–7, 8–15 and 16–23 are the log codes of R, G and B over `[2^-4, 2^3]` (0 = zero); bits 24–31 are alpha.
````

- [ ] **Step 6: Commit**

```bash
cd D:/claude/real-hall/repo
git add docs/engineering/relight-package.md tools/relight/relight/__init__.py tools/relight/relight/codec.py tools/relight/tests/__init__.py tools/relight/tests/test_codec.py
git diff --cached --stat
git commit -m "feat(relight): the relight package contract and its byte codec (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The proof's light model, moved into the repo

**Files:**
- Create: `tools/relight/config/grand-hall.json`, `tools/relight/relight/config.py`, `tools/relight/relight/gpulock.py`, `tools/relight/relight/__main__.py`, `tools/relight/tests/test_config.py`
- Create (moved): `tools/relight/proof/` with the proof scripts `common.py`, `lt.py`, `radiosity.py`, `store.py`, `01_extract.py`, `02_geometry.py`, `02b_occ_e57.py`, `02c_cookie.py`, `03_bases.py`, `03b_window_fresnel.py`, `03c_embrasure_roomside.py`, `03d_embrasure_back.py`, `04_fit.py`, `05_relight.py`, `07_compare.py`, `pano_view.py`

**Interfaces:**
- Produces: `config.load(path) -> Config` (a frozen dataclass with `paths` and `room` dicts); `gpulock.hold(owner)` context manager; the CLI `python -m relight proof <step>` for steps `extract geometry occupancy cookie bases fresnel embrasure-room embrasure-back fit` (or `all`); the proof's work tables in `<work>/npy/*.npy` with the proof's names and shapes (`splats_pos` (N,3) f32 e57, `geom_cls` (N,) u8, `geom_chand_id` (N,) i8, `bases_E_win` (N,20) f16, `bases_E_ch` (N,2), `bases_E_dome` (N,), `bases_E_cove` (N,), `bases_n` (N,3), `bases_iso` (N,), `splats_tile` (N,) u8, `splats_opa`, `splats_rgb`, `splats_scl`, `E_cap` (N,3)), and `<work>/fit.json`, `probes.npz`, `patches.npz`, `occ_cookie.npz`, `fit_state.npz`.

- [ ] **Step 1: Write the failing config test**

`tools/relight/tests/test_config.py`:

```python
import json, os, tempfile, unittest
from relight import config

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Config(unittest.TestCase):
    def write(self, data):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(data, f); f.close()
        self.addCleanup(os.unlink, f.name)
        return f.name

    def test_loads_the_grand_hall_config(self):
        cfg = config.load(os.path.join(HERE, "config", "grand-hall.json"))
        self.assertEqual(cfg.room["slug"], "grand-hall")
        self.assertEqual(len(cfg.room["windows"]), 5)
        self.assertTrue(cfg.paths["work"].startswith("D:/"))

    def test_refuses_a_missing_key(self):
        with self.assertRaises(ValueError):
            config.load(self.write({"schema": "venviewer.relight-config.v1", "paths": {}, "room": {}}))

    def test_refuses_outputs_on_c(self):
        data = json.load(open(os.path.join(HERE, "config", "grand-hall.json")))
        data["paths"]["work"] = "C:/tmp/relight"
        with self.assertRaises(ValueError):
            config.load(self.write(data))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_config -v`
Expected: FAIL, no module `relight.config`.

- [ ] **Step 3: Write the config, loader and lock**

`tools/relight/config/grand-hall.json` (constants copied from the proof's `common.py`):

```json
{
  "schema": "venviewer.relight-config.v1",
  "paths": {
    "splats": "D:/claude/splats/trades-hall/grand-hall",
    "canonicalFrame": "D:/claude/splat-quality-20260923/canonical-frame-court/canonical_frame.json",
    "audit": "D:/claude/splat-quality-20260923/capture-lighting-audit",
    "horizon": "D:/claude/splat-quality-20260923/weather-daylight/horizon.json",
    "proofWork": "D:/claude/real-hall/renovation/relight/work",
    "work": "D:/claude/relight/grand-hall/work",
    "out": "D:/claude/splats/trades-hall/grand-hall/relight/v1",
    "evidence": "D:/claude/relight/grand-hall/evidence",
    "floorSkin": "D:/claude/splats/trades-hall/grand-hall/floor-skin/v1",
    "bundle": "packages/web/src/data/generated/trades-hall-splat-bundles.ts",
    "repo": "D:/claude/real-hall/repo"
  },
  "room": {
    "slug": "grand-hall",
    "site": { "latitude": 55.8593, "longitude": -4.2491, "xBearingDeg": 14.3 },
    "hallE57": { "x0": -1.823, "x1": 19.307, "y0": -10.329, "y1": 0.301, "floorZ": 0.02, "ceilingZ": 6.78 },
    "windows": {
      "W1": [-1.60, 1.15, 0.85, 0.90, 5.35, "arch"],
      "W2": [3.20, 4.70, 0.63, 0.95, 3.35, "rect"],
      "W3": [7.30, 10.45, 0.50, 0.50, 5.50, "arch"],
      "W4": [12.90, 14.50, 0.63, 0.90, 3.35, "rect"],
      "W5": [16.30, 19.10, 0.85, 0.85, 5.30, "arch"]
    },
    "finestTiles": ["env.sog", "0_0_0_1_0_1.sog", "0_1_0_1_0_0.sog", "0_2_0_0_1_1.sog", "0_3_0_0_0_0.sog", "0_3_0_1_0_1.sog",
                    "0_4_0_1_0_0.sog", "0_5_0_0_0_1.sog", "0_5_0_1_0_1.sog", "0_6_0_0_0_1.sog", "0_7_0_0_0_0.sog", "0_7_0_0_0_1.sog"],
    "manifestTranslation": [4.911651, 2.2253407083333334, -8.571432999999999],
    "probeSpacing": 0.5,
    "floorTexel": 0.05,
    "transferNeighbours": 8
  }
}
```

`tools/relight/relight/config.py`:

```python
"""The bake's configuration: every input path and room constant in one JSON file."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

SCHEMA = "venviewer.relight-config.v1"
PATH_KEYS = ("splats", "canonicalFrame", "audit", "horizon", "proofWork", "work", "out", "evidence", "floorSkin", "bundle", "repo")
ROOM_KEYS = ("slug", "site", "hallE57", "windows", "finestTiles", "manifestTranslation", "probeSpacing", "floorTexel", "transferNeighbours")
OUTPUT_KEYS = ("work", "out", "evidence")


@dataclass(frozen=True)
class Config:
    paths: dict[str, str]
    room: dict[str, Any]


def load(path: str) -> Config:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("schema") != SCHEMA:
        raise ValueError(f"config schema must be {SCHEMA}")
    paths, room = data.get("paths", {}), data.get("room", {})
    missing = [k for k in PATH_KEYS if k not in paths] + [k for k in ROOM_KEYS if k not in room]
    if missing:
        raise ValueError("config is missing: " + ", ".join(missing))
    for key in OUTPUT_KEYS:
        if not paths[key].upper().startswith("D:/"):
            raise ValueError(f"{key} must be on D: (C: fills up; see the plan's constraints)")
    if sorted(room["windows"]) != ["W1", "W2", "W3", "W4", "W5"]:
        raise ValueError("the Grand Hall has windows W1..W5")
    return Config(paths=dict(paths), room=dict(room))
```

`tools/relight/relight/gpulock.py`:

```python
"""The build PC's shared GPU lock (one GPU-heavy job at a time)."""
from __future__ import annotations

import contextlib, datetime, json, os, time

LOCK = "D:/claude/visual-firstprinciples-20260928/gpu.lock"


@contextlib.contextmanager
def hold(owner: str, poll_s: float = 5.0):
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            time.sleep(poll_s)
    with os.fdopen(fd, "w") as f:
        json.dump({"owner": owner, "since": datetime.datetime.now().astimezone().isoformat()}, f)
    try:
        yield
    finally:
        os.remove(LOCK)
```

- [ ] **Step 4: Run the config test to verify it passes**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_config -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Move the proof's scripts**

Copy byte for byte, then edit only as the next step says:

```bash
mkdir -p D:/claude/real-hall/repo/tools/relight/proof
cd D:/claude/real-hall/renovation/relight/scripts
cp common.py lt.py radiosity.py store.py 01_extract.py 02_geometry.py 02b_occ_e57.py 02c_cookie.py 03_bases.py 03b_window_fresnel.py 03c_embrasure_roomside.py 03d_embrasure_back.py 04_fit.py 05_relight.py 07_compare.py pano_view.py D:/claude/real-hall/repo/tools/relight/proof/
```

- [ ] **Step 6: Point the scripts at the config**

In `tools/relight/proof/common.py`, replace the block from `ROOT = ` through `REPO = `, and the `TILES`, `MANIFEST_T`, `X0, X1, Y0, Y1`, `FLOOR_Z`, `CEIL_Z` and `WINDOWS` literals, with reads from the config named by `RELIGHT_CONFIG`:

```python
import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from relight import config as _config  # noqa: E402

CFG = _config.load(os.environ["RELIGHT_CONFIG"])
ROOT = os.path.dirname(CFG.paths["work"])
WORK = CFG.paths["work"]
SPLATS = CFG.paths["splats"]
CANON = CFG.paths["canonicalFrame"]
AUDIT = CFG.paths["audit"]
REPO = CFG.paths["repo"]
TILES = list(CFG.room["finestTiles"])
MANIFEST_T = np.array(CFG.room["manifestTranslation"])
_h = CFG.room["hallE57"]
X0, X1, Y0, Y1 = _h["x0"], _h["x1"], _h["y0"], _h["y1"]
FLOOR_Z = _h["floorZ"]
CEIL_Z = _h["ceilingZ"]
FACADE_NORMAL_BEARING = 104.3
WINDOWS = {k: tuple(v) for k, v in CFG.room["windows"].items()}
```

In `tools/relight/proof/lt.py`, replace `HORIZON_FILE = "…"` with `HORIZON_FILE = CFG.paths["horizon"]`. Then list every remaining literal path:

Run: `cd D:/claude/real-hall/repo/tools/relight/proof && grep -nE "[A-Z]:/" *.py`
Expected: no hits once done. Replace each hit with the matching `CFG.paths[...]` entry. The Matterport panoramas used by `pano_view.py` and `07_compare.py` live under the audit folder (`CFG.paths["audit"]`); if a hit names an input the config lacks, add a `paths` key for it and add that key to `PATH_KEYS`.

- [ ] **Step 7: Write the CLI**

`tools/relight/relight/__main__.py` (later tasks add commands to `COMMANDS`):

```python
"""python -m relight <command> [step] --config config/grand-hall.json"""
from __future__ import annotations

import argparse, os, runpy, sys

from . import config, gpulock

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROOF = os.path.join(HERE, "proof")
# proof step -> (script, needs the GPU)
PROOF_STEPS = {
    "extract": ("01_extract.py", False),
    "geometry": ("02_geometry.py", True),
    "occupancy": ("02b_occ_e57.py", False),
    "cookie": ("02c_cookie.py", False),
    "bases": ("03_bases.py", True),
    "fresnel": ("03b_window_fresnel.py", True),
    "embrasure-room": ("03c_embrasure_roomside.py", True),
    "embrasure-back": ("03d_embrasure_back.py", True),
    "fit": ("04_fit.py", True),
}
COMMANDS: dict = {}


def use_proof(cfg_path: str) -> None:
    """Make the moved proof scripts importable with the given config."""
    os.environ["RELIGHT_CONFIG"] = os.path.abspath(cfg_path)
    if PROOF not in sys.path:
        sys.path.insert(0, PROOF)


def run_proof(step: str, cfg_path: str) -> None:
    script, gpu = PROOF_STEPS[step]
    use_proof(cfg_path)
    old = os.getcwd()
    os.chdir(PROOF)
    try:
        if gpu:
            with gpulock.hold(f"relight-bake {step}"):
                runpy.run_path(os.path.join(PROOF, script), run_name="__main__")
        else:
            runpy.run_path(os.path.join(PROOF, script), run_name="__main__")
    finally:
        os.chdir(old)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="relight")
    ap.add_argument("command")
    ap.add_argument("step", nargs="?")
    ap.add_argument("--config", required=True)
    args = ap.parse_args(argv)
    cfg = config.load(args.config)
    os.makedirs(cfg.paths["work"], exist_ok=True)
    os.makedirs(cfg.paths["evidence"], exist_ok=True)
    if args.command == "proof":
        steps = list(PROOF_STEPS) if args.step in (None, "all") else [args.step]
        for step in steps:
            print(f"== proof {step}", flush=True)
            run_proof(step, args.config)
        return 0
    if args.command in COMMANDS:
        use_proof(args.config)
        return COMMANDS[args.command](cfg, args)
    ap.error(f"unknown command {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

Later tasks register commands by appending `from .commands_<name> import register` style functions; to keep the CLI one file, they add their function above `if __name__ == "__main__":` and a line `COMMANDS["<name>"] = <function>`.

- [ ] **Step 8: Run the moved light model**

Run (hours; the GPU steps wait for the lock by themselves):

```bash
cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m relight proof all --config config/grand-hall.json 2>&1 | tee D:/claude/relight/grand-hall/evidence/proof-run.log
```

Expected: each step prints its progress and ends without a traceback; `D:/claude/relight/grand-hall/work/` holds `fit.json`, `probes.npz`, `patches.npz`, `occ_cookie.npz`, `fit_state.npz` and the `npy/` tables.

- [ ] **Step 9: Check the move reproduces the proof**

Run:

```bash
C:/Python313/python.exe - <<'EOF'
import json, numpy as np
a = json.load(open("D:/claude/real-hall/renovation/relight/work/fit.json")); b = json.load(open("D:/claude/relight/grand-hall/work/fit.json"))
wa, wb = np.array(a["weights"]), np.array(b["weights"])
print("bases", a["bases"] == b["bases"], "max weight change", float(np.max(np.abs(wb - wa) / np.maximum(np.abs(wa), 1e-6))))
ea = np.load("D:/claude/real-hall/renovation/relight/work/npy/E_cap.npy", mmap_mode="r"); eb = np.load("D:/claude/relight/grand-hall/work/npy/E_cap.npy", mmap_mode="r")
i = np.arange(0, ea.shape[0], 97)
la, lb = np.asarray(ea[i]) @ [0.2126, 0.7152, 0.0722], np.asarray(eb[i]) @ [0.2126, 0.7152, 0.0722]
ok = (la > 1e-6) & (lb > 1e-6)
print("N", ea.shape[0], eb.shape[0], "median |dlog2 Ecap|", float(np.median(np.abs(np.log2(lb[ok]) - np.log2(la[ok])))))
EOF
```

Expected: `bases True`, maximum relative weight change ≤ 0.01, `N 6030980 6030980`, median |Δlog2 Ecap| ≤ 0.02. Save the printout as `D:/claude/relight/grand-hall/evidence/proof-reproduction.txt`. If a number misses, stop and report it: the move changed behaviour.

- [ ] **Step 10: Commit**

```bash
cd D:/claude/real-hall/repo
git add tools/relight/config/grand-hall.json tools/relight/relight/config.py tools/relight/relight/gpulock.py tools/relight/relight/__main__.py tools/relight/tests/test_config.py tools/relight/proof
git diff --cached --stat
git commit -m "feat(relight): move the proof's light model into tools/relight, paths from one config (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**As built (30 September).** Execution found six issues in the text above. The committed code and the task report
(`task-2-report.md` in the SDD workspace) are the record:

- Step order: `extract geometry occupancy cookie bases tables fresnel lamp-colour fit embrasure-room embrasure-back`.
  `03c` and `03d` read `fit_state.npz`, which only `04_fit.py` writes, so the fit runs before them, as it did in the
  proof.
- `tables` splits every N-row array of `splats.npz`, `geom.npz` and `bases.npz` into `npy/<archive>_<key>.npy` (the
  proof did this with inline code that was not saved). `lamp-colour` validates the proof's measured
  `lamp_daylight_ratio.json` and copies it.
- Every proof step is CPU-only and takes no GPU lock. `gpulock.hold` removes only its own record
  (`tests/test_gpulock.py`).
- `paths.panoramas` names the Matterport panorama folder, which is not under the audit folder.
- Step 9's weight metric compares only weights at least 1e-6 in both fits. `ch_centre` sits at the solver's lower bound
  (about 1e-11), where the original metric turns an 8.5e-8 absolute change into 0.0855.
- This PC corrupts some computations under load. Run 1 had 21 wrong probe values out of 36 million. The data was rerun
  step by step in separate processes and checked array by array against the proof. Any difference is settled by a
  third run and a majority vote. Tasks 3 to 5 follow the same rule: each data-producing command runs twice, and the
  outputs must match byte for byte.

### Task 3: Windows: stencils, horizons and sun reach

**Files:**
- Create: `tools/relight/relight/windows.py`, `tools/relight/tests/test_windows.py`
- Modify: `tools/relight/relight/__main__.py` (register `windows`, `check-stencils`)

**Interfaces:**
- Consumes: `proof/lt.py` (`load_occ`, `horizon_deg`, `glass_t`, `sun_direct`), `proof/common.py` (`WINDOWS`, `Y0`, `X0`, `X1`, `Y1`, `FLOOR_Z`, `sun_vec_e57`, `solar_position`), `<work>/occ_cookie.npz` (`occ` (X,Y,Z) f16 alpha, `occ_lo` (3,), `occ_res`).
- Produces: `windows.Plane` (dataclass: `origin`, `u`, `v`, `width`, `height`, `normal`, `stencil` float32 (h, w) transmittance, row 0 at the top); `windows.stencils_from_occupancy(occ, lo, res, window, y0) -> (inner Plane, glass Plane)`; `windows.visibility(planes, P, sun) -> (N,) float32`; `windows.fresnel_table(glass_t) -> 101 floats`; `windows.horizon_table(horizon_fn, w_index) -> 360 floats`; `windows.sun_directions(...) -> (K,3)`; `windows.sun_reach(planes_by_window, P, directions) -> (N,) bool`; files `<work>/windows.npz` and `<evidence>/stencil-sun.json`.

- [ ] **Step 1: Write the failing tests**

`tools/relight/tests/test_windows.py` (synthetic data; no GPU, no D: inputs):

```python
import unittest
import numpy as np
from relight import windows


def plane(y, x0=0.0, x1=2.0, z0=1.0, z1=3.0, stencil=None):
    st = np.ones((20, 20), np.float32) if stencil is None else stencil
    return windows.Plane(origin=np.array([x0, y, z1]), u=np.array([1.0, 0, 0]), v=np.array([0, 0, -1.0]),
                         width=x1 - x0, height=z1 - z0, normal=np.array([0, -1.0, 0]), stencil=st)


class Visibility(unittest.TestCase):
    def test_a_ray_through_both_openings_is_lit(self):
        inner, glass = plane(0.0), plane(-0.5)
        v = windows.visibility((inner, glass), np.array([[1.0, 3.0, 2.0]]), np.array([0.0, -1.0, 0.0]))
        self.assertAlmostEqual(float(v[0]), 1.0, places=5)

    def test_a_ray_missing_the_glass_opening_is_dark(self):
        inner, glass = plane(0.0), plane(-0.5)
        sun = np.array([-0.8, -0.6, 0.0]) / np.linalg.norm([-0.8, -0.6, 0.0])
        # crosses the inner plane at x = 0.2 (inside), the glass plane at x = -0.47 (outside)
        v = windows.visibility((inner, glass), np.array([[2.2, 1.5, 2.0]]), sun)
        self.assertEqual(float(v[0]), 0.0)

    def test_stencils_multiply(self):
        st = np.full((20, 20), 0.5, np.float32)
        inner, glass = plane(0.0, stencil=st), plane(-0.5, stencil=st)
        v = windows.visibility((inner, glass), np.array([[1.0, 3.0, 2.0]]), np.array([0.0, -1.0, 0.0]))
        self.assertAlmostEqual(float(v[0]), 0.25, places=4)

    def test_sun_behind_the_wall_is_dark(self):
        inner, glass = plane(0.0), plane(-0.5)
        v = windows.visibility((inner, glass), np.array([[1.0, 3.0, 2.0]]), np.array([0.0, 1.0, 0.0]))
        self.assertEqual(float(v[0]), 0.0)


class Stencils(unittest.TestCase):
    def test_a_bar_at_the_glass_depth_lands_in_the_glass_stencil_only(self):
        res, lo = 0.03, np.array([0.0, -1.0, 0.0])
        occ = np.zeros((100, 34, 100), np.float32)
        occ[45:48, 16:18, :] = 0.99          # a vertical bar at x = 1.35..1.44, y = -0.52..-0.46 (the glass depth)
        window = (0.3, 2.7, 0.5, 0.3, 2.7, "rect")
        inner, glass = windows.stencils_from_occupancy(occ, lo, res, window, y0=0.0)
        col = int(round((1.4 - glass.origin[0]) / glass.width * (glass.stencil.shape[1] - 1)))
        self.assertLess(float(glass.stencil[:, col].mean()), 0.2)
        self.assertGreater(float(inner.stencil[:, col].mean()), 0.9)


class Tables(unittest.TestCase):
    def test_fresnel_table_has_101_entries_rising_to_normal_incidence(self):
        t = windows.fresnel_table(lambda c: 0.92 * c ** 0.1)
        self.assertEqual(len(t), 101)
        self.assertGreater(t[100], t[10])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_windows -v`
Expected: FAIL, no module `relight.windows`.

- [ ] **Step 3: Write the stencils and visibility**

`tools/relight/relight/windows.py`:

```python
"""Two-plane window stencils: the browser's live sun test (spec 4.3).

Each window is modelled by its room-side plane (the wall's inner face, y = y0) and its glass
plane (y = y0 - depth). The inner stencil is the transmittance of everything between the two
planes (curtains, columns, reveals) projected along the wall normal; the glass stencil is the
transmittance of the glazing bars and tracery within 4.5 cm of the glass. A ray toward the sun
is lit by their product where it crosses both planes inside the opening.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

GLASS_HALF_DEPTH = 0.045


@dataclass
class Plane:
    origin: np.ndarray   # top-left corner of the opening's bounding box
    u: np.ndarray        # unit, along the width
    v: np.ndarray        # unit, downward along the height
    width: float
    height: float
    normal: np.ndarray   # outward (toward the street)
    stencil: np.ndarray  # (h, w) float32 transmittance, row 0 at the top


def stencils_from_occupancy(occ, lo, res, window, y0):
    """occ (X, Y, Z) alpha in cells of `res` from corner `lo` (e57 frame); window = (x0, x1, depth, sill, top, kind)."""
    x0, x1, depth, sill, top, _kind = window
    dens = -np.log1p(-np.clip(occ.astype(np.float64), 0.0, 0.995))
    ix0, ix1 = max(int(np.floor((x0 - lo[0]) / res)), 0), min(int(np.ceil((x1 - lo[0]) / res)), occ.shape[0])
    iz0, iz1 = max(int(np.floor((sill - lo[2]) / res)), 0), min(int(np.ceil((top - lo[2]) / res)), occ.shape[2])
    yc = lo[1] + (np.arange(occ.shape[1]) + 0.5) * res
    y_glass = y0 - depth
    in_glass = np.abs(yc - y_glass) <= GLASS_HALF_DEPTH
    in_inner = (yc < y0) & (yc > y_glass + GLASS_HALF_DEPTH)
    slab = dens[ix0:ix1, :, iz0:iz1]
    glass = np.exp(-slab[:, in_glass, :].sum(axis=1)).astype(np.float32)     # (w, h), z upward
    inner = np.exp(-slab[:, in_inner, :].sum(axis=1)).astype(np.float32)
    glass, inner = glass.T[::-1].copy(), inner.T[::-1].copy()                 # (h, w), row 0 at the top
    width, height = (ix1 - ix0) * res, (iz1 - iz0) * res
    x_left, z_top = lo[0] + ix0 * res, lo[2] + iz1 * res
    u, v, n = np.array([1.0, 0, 0]), np.array([0, 0, -1.0]), np.array([0, -1.0, 0])
    return (Plane(np.array([x_left, y0, z_top]), u, v, width, height, n, inner),
            Plane(np.array([x_left, y_glass, z_top]), u, v, width, height, n, glass))


def _sample(plane: Plane, q: np.ndarray) -> np.ndarray:
    d = q - plane.origin
    a, b = d @ plane.u, d @ plane.v
    inside = (a >= 0) & (a <= plane.width) & (b >= 0) & (b <= plane.height)
    h, w = plane.stencil.shape
    col = np.clip(np.rint(a / plane.width * (w - 1)), 0, w - 1).astype(np.int64)
    row = np.clip(np.rint(b / plane.height * (h - 1)), 0, h - 1).astype(np.int64)
    return np.where(inside, plane.stencil[row, col], 0.0)


def visibility(planes, P, sun) -> np.ndarray:
    """Transmittance of the rays P + t sun (t > 0) through both planes of one window."""
    P = np.asarray(P, np.float64)
    sun = np.asarray(sun, np.float64)
    out = np.ones(len(P), np.float64)
    for plane in planes:
        denom = float(sun @ plane.normal)
        if denom <= 1e-6:
            return np.zeros(len(P), np.float32)
        t = ((plane.origin - P) @ plane.normal) / denom
        q = P + t[:, None] * sun[None]
        out *= np.where(t > 0, _sample(plane, q), 0.0)
    return out.astype(np.float32)


def fresnel_table(glass_t) -> list[float]:
    return [float(glass_t(c / 100.0)) for c in range(101)]


def horizon_table(horizon_fn, w_index: int) -> list[float]:
    return [float(horizon_fn(w_index, float(az))) for az in range(360)]


def sun_directions(solar_position, sun_vec, year=2026, step_min=15):
    """Unit sun vectors (model frame): the 21st of each month, 04:00-22:00 UTC every step_min minutes, sun up."""
    out = []
    for month in range(1, 13):
        for minute in range(4 * 60, 22 * 60, step_min):
            az, el = solar_position(year, month, 21, minute // 60, minute % 60)
            if el > 0.5:
                out.append(sun_vec(az, el))
    return np.array(out)


def sun_reach(planes_by_window, P, directions, chunk=500_000) -> np.ndarray:
    """True where some sun direction reaches P through some window (transmittance above 0.02)."""
    reach = np.zeros(len(P), bool)
    for a in range(0, len(P), chunk):
        Pc = P[a:a + chunk]
        r = np.zeros(len(Pc), bool)
        for s in directions:
            for planes in planes_by_window.values():
                r |= visibility(planes, Pc, s) > 0.02
        reach[a:a + chunk] = r
    return reach
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_windows -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Register the `windows` command**

Add to `tools/relight/relight/__main__.py`, above `if __name__ == "__main__":`:

```python
def windows_planes(cfg):
    """{name: (inner, glass)} from <work>/windows.npz."""
    import numpy as np
    from . import windows as W
    wz = np.load(os.path.join(cfg.paths["work"], "windows.npz"))
    def plane(name, tag):
        f = wz[f"{name}_{tag}_frame"]
        return W.Plane(f[0:3], f[3:6], f[6:9], float(f[12]), float(f[13]), f[9:12], wz[f"{name}_{tag}_stencil"])
    return {n: (plane(n, "inner"), plane(n, "glass")) for n in ("W1", "W2", "W3", "W4", "W5")}, wz


def cmd_windows(cfg, args) -> int:
    import numpy as np
    import common, lt, torch
    from . import windows as W
    g = np.load(os.path.join(cfg.paths["work"], "occ_cookie.npz"))
    occ, lo, res = g["occ"].astype(np.float32), np.asarray(g["occ_lo"], np.float64), float(g["occ_res"])
    save = {}
    for i, name in enumerate(common.WINDOWS):
        inner, glass = W.stencils_from_occupancy(occ, lo, res, common.WINDOWS[name], common.Y0)
        for tag, p in (("inner", inner), ("glass", glass)):
            save[f"{name}_{tag}_stencil"] = p.stencil
            save[f"{name}_{tag}_frame"] = np.concatenate([p.origin, p.u, p.v, p.normal, [p.width, p.height]])
        save[f"{name}_horizon"] = np.array(W.horizon_table(
            lambda wi, az: float(lt.horizon_deg(torch.tensor([wi]), torch.tensor([az]))[0]), i), np.float32)
    save["fresnel"] = np.array(W.fresnel_table(lambda c: float(lt.glass_t(c))), np.float32)
    np.savez_compressed(os.path.join(cfg.paths["work"], "windows.npz"), **save)
    print("windows.npz written", flush=True)
    return 0


COMMANDS["windows"] = cmd_windows
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m relight windows --config config/grand-hall.json`
Expected: `windows.npz written`. (`lt.horizon_deg` and `lt.glass_t` take torch tensors or floats as the proof calls them; if a call signature differs, adapt the lambda, not the proof.)

- [ ] **Step 6: Check the two-plane sun against the proof's 3D march**

Add a `check-stencils` command:

```python
def cmd_check_stencils(cfg, args) -> int:
    import json
    import numpy as np
    import common, lt
    from . import windows as W
    planes, wz = windows_planes(cfg)
    xs = np.arange(common.X0 + 0.05, common.X1 - 0.05, 0.05); ys = np.arange(common.Y0 + 0.05, common.Y1 - 0.05, 0.05)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    P = np.stack([X.ravel(), Y.ravel(), np.full(X.size, common.FLOOR_Z + 0.02)], 1)
    occ = lt.load_occ("cookie")
    fres = wz["fresnel"]
    report = []
    for (y, mo, d, hh, mi) in [(2026, 5, 31, 8, 0), (2026, 6, 21, 6, 0), (2026, 6, 21, 9, 0), (2026, 3, 20, 9, 0), (2026, 12, 21, 10, 30)]:
        az, el = common.solar_position(y, mo, d, hh, mi)
        s = common.sun_vec_e57(az, el)
        t3 = lt.sun_direct(occ, P, s).numpy()          # the proof's 3D march, torch on the CPU
        t2 = sum(W.visibility(p, P, s) for p in planes.values()) * fres[int(round(min(abs(s[1]), 1.0) * 100))]
        a, b = t3 > 0.3, t2 > 0.3
        union = a | b
        report.append({"utc": f"{y}-{mo:02d}-{d:02d}T{hh:02d}:{mi:02d}", "az": round(float(az), 2), "el": round(float(el), 2),
                       "iou": round(float((a & b).sum() / max(union.sum(), 1)), 4),
                       "meanAbsDiff": round(float(np.abs(t3 - t2)[union].mean()) if union.any() else 0.0, 4),
                       "litCells3d": int(a.sum()), "litCells2plane": int(b.sum())})
    ok = all(r["iou"] >= 0.85 and r["meanAbsDiff"] <= 0.1 for r in report if r["litCells3d"] > 0)
    json.dump({"threshold": {"iou": 0.85, "meanAbsDiff": 0.1}, "pass": ok, "directions": report},
              open(os.path.join(cfg.paths["evidence"], "stencil-sun.json"), "w"), indent=1)
    print(json.dumps(report, indent=1), "PASS" if ok else "FAIL", flush=True)
    return 0 if ok else 1


COMMANDS["check-stencils"] = cmd_check_stencils
```

Run: `C:/Python313/python.exe -m relight check-stencils --config config/grand-hall.json`
Expected: `PASS`: every direction with a lit floor has IoU ≥ 0.85 and mean |ΔT| ≤ 0.1. If it fails, report the per-direction numbers and stop; do not loosen the thresholds (the controller chooses between a third plane and accepting softer patches).

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo
git add tools/relight/relight/windows.py tools/relight/relight/__main__.py tools/relight/tests/test_windows.py
git diff --cached --stat
git commit -m "feat(relight): two-plane window stencils, horizons and the check against the 3D sun (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Bounce probes, sun bounce and floor light maps

**Files:**
- Create: `tools/relight/relight/probes.py`, `tools/relight/relight/floorlight.py`, `tools/relight/tests/test_probes.py`
- Modify: `tools/relight/relight/__main__.py` (register `probes`, `floor`)

**Interfaces:**
- Consumes: `proof/radiosity.py` (`form_factors`, `radiosity`, `probe_indirect`, `patch_sun`), `proof/04_fit.py` (`SKY_W`), `proof/05_relight.py` (`sun_samples`, `scenario_light`, `SCENARIOS`), `<work>/fit_state.npz`, `<work>/patches.npz`, `proof/lt.py` (`window_cubes`, `point_cubes`, `cove_cubes`, `dome_ring_lights`, `dome_visible`, `cube_eval`), the floor skin v1 manifest.
- Produces: `probes.coarse_grid(hall, spacing) -> (P (M,3), shape, origin)`; `probes.valid_mask(P, hall, inset) -> (M,) bool`; `probes.patch_direct_by_source(patches, sky_w) -> (P, 9)`; `probes.bounce_probes(radiosity_mod, patches, rho, sky_w, probe_points) -> (M, 9, 3, 6)`; `probes.sun_bounce_weights_from_area(area (5,), sky_flux (5,), beta) -> (5,)`; `floorlight.floor_grid(floor_manifest, texel) -> dict`; files `<work>/probes-coarse.npz` (`cubes` f16, `valid`, `origin`, `shape`, `spacing`), `<work>/sun-bounce.json`, `<work>/floor-light.npz` (`D` (h, w, 9) f32, `texelToModel` (4,4)).

- [ ] **Step 1: Write the failing tests**

`tools/relight/tests/test_probes.py`:

```python
import unittest
import numpy as np
from relight import probes

HALL = {"x0": 0.0, "x1": 2.0, "y0": 0.0, "y1": 1.0, "floorZ": 0.0, "ceilingZ": 1.0}


class Grid(unittest.TestCase):
    def test_coarse_grid_covers_the_hall_at_the_spacing(self):
        P, shape, origin = probes.coarse_grid(HALL, 0.5)
        self.assertEqual(tuple(shape), (5, 3, 3))
        self.assertEqual(P.shape, (45, 3))
        self.assertTrue(np.allclose(origin, [0.0, 0.0, 0.0]))

    def test_probes_outside_the_hall_are_invalid(self):
        P = np.array([[1.0, 0.5, 0.5], [3.0, 0.5, 0.5], [1.0, 0.5, -0.2]])
        self.assertEqual(probes.valid_mask(P, HALL, inset=0.01).tolist(), [True, False, False])


class PatchDirect(unittest.TestCase):
    def test_windows_combine_their_four_bands(self):
        n = 2
        patches = {"E_win": np.ones((n, 20), np.float32), "E_cove": np.full(n, 2.0), "E_ch": np.full((n, 2), 3.0), "E_dome": np.full(n, 4.0)}
        d = probes.patch_direct_by_source(patches, np.array([0.15, 0.66, 1.0, 1.21]))
        self.assertEqual(d.shape, (2, 9))
        self.assertAlmostEqual(float(d[0, 0]), 3.02, places=5)
        self.assertEqual(d[0, 5:].tolist(), [2.0, 3.0, 3.0, 4.0])


class SunBounce(unittest.TestCase):
    def test_bounce_weights_scale_with_the_sunlit_glass_area(self):
        w = probes.sun_bounce_weights_from_area(np.array([0.0, 2.0, 1.0, 0.0, 0.0]), np.ones(5), beta=0.5)
        self.assertEqual(w.tolist(), [0.0, 1.0, 0.5, 0.0, 0.0])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_probes -v`
Expected: FAIL, no module `relight.probes`.

- [ ] **Step 3: Write the probes module**

`tools/relight/relight/probes.py`:

```python
"""Per-source bounce light on a coarse probe grid, and the sun-bounce weights (spec 4.2, 4.3).

Radiosity is linear in the direct light, so each source's bounce is solved on its own with a white
unit source; the browser multiplies by the source's colour and weight. The sun's bounce is carried
by the window sources' probes, scaled by the sunlit glass area of each window.
"""
from __future__ import annotations

import numpy as np


def coarse_grid(hall, spacing):
    lo = np.array([hall["x0"], hall["y0"], hall["floorZ"]], np.float64)
    hi = np.array([hall["x1"], hall["y1"], hall["ceilingZ"]], np.float64)
    shape = np.floor((hi - lo) / spacing + 1e-9).astype(np.int64) + 1
    axes = [lo[i] + np.arange(shape[i]) * spacing for i in range(3)]
    X, Y, Z = np.meshgrid(*axes, indexing="ij")
    return np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1), shape, lo


def valid_mask(P, hall, inset=0.02):
    return ((P[:, 0] >= hall["x0"] + inset) & (P[:, 0] <= hall["x1"] - inset)
            & (P[:, 1] >= hall["y0"] + inset) & (P[:, 1] <= hall["y1"] - inset)
            & (P[:, 2] >= hall["floorZ"] + inset) & (P[:, 2] <= hall["ceilingZ"] - inset))


def patch_direct_by_source(patches, sky_w):
    """(P, 9) direct light per patch; each window combines its facade and sky bands with the capture's sky_w."""
    cols = [np.asarray(patches["E_win"][:, 4 * w:4 * w + 4], np.float64) @ sky_w for w in range(5)]
    cols += [patches["E_cove"], patches["E_ch"][:, 0], patches["E_ch"][:, 1], patches["E_dome"]]
    return np.stack([np.asarray(c, np.float64) for c in cols], 1).astype(np.float32)


def bounce_probes(radiosity_mod, patches, rho, sky_w, probe_points):
    """(M, 9, 3, 6) indirect ambient cubes per source at the probe points (white unit sources)."""
    F = radiosity_mod.form_factors(patches["P"], patches["N"], patches["A"], patches["opening"])
    Edir = patch_direct_by_source(patches, sky_w)
    B = radiosity_mod.radiosity(F, rho, Edir)                        # (P, 9, 3)
    return radiosity_mod.probe_indirect(probe_points, patches, B).numpy().astype(np.float32)


def sun_bounce_weights_from_area(sunlit_area, sky_flux, beta):
    return beta * np.asarray(sunlit_area, np.float64) / np.maximum(np.asarray(sky_flux, np.float64), 1e-9)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_probes -v`
Expected: PASS, 4 tests.

- [ ] **Step 5: Bake the coarse probes and calibrate the sun bounce**

Register a `probes` command. It runs on the CPU (the proof's torch code has no CUDA; it takes no GPU lock) and does, in order:

1. `P, shape, origin = probes.coarse_grid(cfg.room["hallE57"], cfg.room["probeSpacing"])`; `valid = probes.valid_mask(P, cfg.room["hallE57"])`.
2. Loads `patches.npz` and the fitted patch albedo from `fit_state.npz`: print `np.load(...).files` and use the array `04_fit.py` saves as the patch albedo (the proof's `05_relight.py` reads it as `FIT["rho"]`).
3. `cubes = probes.bounce_probes(radiosity, patches, rho, np.array(fit04.SKY_W), P)`; writes `probes-coarse.npz` with `cubes.astype(np.float16)`, `valid`, `origin`, `shape`, `spacing`.
4. Linearity check: the capture's bounce `Σk w[k] c[k] ⊙ cubes[:, k]` (weights and colours from `fit.json`, the first nine bases with `sun_cap` dropped) against the proof's own capture bounce solved directly with `radiosity(F, rho, PDIR_CAP)` then `probe_indirect` at the same points: median relative difference of the luminance at valid probes ≤ 2%.
5. Sun-bounce calibration for the proof's sunny morning (`05_relight.SCENARIOS["sunny_morning"]`, its three sun samples from `sun_samples`): the full bounce is `patch_sun` → `radiosity` → `probe_indirect` (the proof's path, `05_relight.patch_direct` restricted to the sun term); the approximation is `Σw b[w] cubes[:, w]` with `b = sun_bounce_weights_from_area(area, skyFlux, β)`. `area[w]` is window w's glass area lit through both stencils: sample the room-side plane on its stencil cells 1 cm inside the room, sum `windows.visibility` times the cell area, times the Fresnel term, times the cosine to the plane normal (the same computation `reference.sun_bounce` uses in Task 5). `skyFlux[w] = Σ patches A × patch_direct_by_source[:, w]`. Fit β by least squares on the valid probes' luminance (a one-parameter fit, closed form) and report the median |Δlog2| of the bounce luminance at valid probes with non-zero full bounce.
6. Writes `<work>/sun-bounce.json`: `{ "beta": β, "skyFlux": [5], "linearityMedianRel": x, "medianAbsDlog2": y, "threshold": 0.25, "pass": y <= 0.25 and x <= 0.02 }`.

Run: `C:/Python313/python.exe -m relight probes --config config/grand-hall.json`
Expected: `pass: true`. If the sun bounce misses 0.25, stop and report: the contingency, a per-direction bounce table on a 1 m grid, is the controller's call.

- [ ] **Step 6: Bake the floor light maps**

`tools/relight/relight/floorlight.py`:

```python
"""Direct light of the nine sources on the floor skin's grid, at 5 cm texels, normal +z (the model frame's up)."""
from __future__ import annotations

import numpy as np


def floor_grid(floor_manifest, texel):
    """Texel counts and size of the floor at `texel` metres over the floor skin's grid extent."""
    g = floor_manifest["grid"]
    width_m, height_m = g["cols"] * g["texel"], g["rows"] * g["texel"]
    return {"w": int(round(width_m / texel)), "h": int(round(height_m / texel)), "width": width_m, "height": height_m}
```

The `floor` command: read `<floorSkin>/floor-skin.json` (v1; the floor-skin builder names its manifest `floor-skin.json`); read the grid's field names from `packages/web/src/lib/floor-skin.ts` (`FloorSkinManifestSchema.grid`) and use them in `floor_grid` if they differ from `cols`/`rows`/`texel`; build the texel centres at `cfg.room["floorTexel"]` in the capture frame from the grid's mapping (the inverse of `captureToMaskMatrix` in `lib/floor-skin.ts`); convert them to e57 with `common.json_to_e57`; set z to the fitted floor plane + 0.02 m; and compute the nine direct values exactly as `proof/03_bases.py` computes its patch direct light (the block that fills `Pw`, `Pch`, `Pdome`, `Pcove` before `np.savez(f"{WORK}/patches.npz", ...)`), with the texel centres as the points, normals +z, and the windows combined with `SKY_W`. Save `<work>/floor-light.npz` with `D` (h, w, 9) float32 and `texelToModel` (4, 4): the matrix that maps a texel centre's `(col, row, 0, 1)` to the model frame, row 0 being the first PNG row (plan R1b relies on exactly this). It runs on the CPU and takes no GPU lock.

Run: `C:/Python313/python.exe -m relight floor --config config/grand-hall.json`
Expected: `floor-light.npz` with no NaN; print each source's maximum and the share of floor texels with non-zero window light (above 0.9 for W3).

- [ ] **Step 7: Commit**

```bash
cd D:/claude/real-hall/repo
git add tools/relight/relight/probes.py tools/relight/relight/floorlight.py tools/relight/relight/__main__.py tools/relight/tests/test_probes.py
git diff --cached --stat
git commit -m "feat(relight): per-source bounce probes, the calibrated sun bounce and floor light maps (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Records for every served tile, the reference multiplier and the checks

**Files:**
- Create: `tools/relight/relight/records.py`, `tools/relight/relight/reference.py`, `tools/relight/relight/package.py`, `tools/relight/tests/test_reference.py`, `tools/relight/tests/test_records.py`
- Create: `packages/web/src/lib/relight/__fixtures__/relight-vectors.json`
- Modify: `tools/relight/relight/__main__.py` (register `records`, `check`)

**Interfaces:**
- Consumes: the Task 2 tables, `windows.npz`, `probes-coarse.npz`, `sun-bounce.json`, `floor-light.npz`, the repo's SOG decoder `tools/xgrids-lcc2/scripts/sog-floor-census.py` (`decode_tile(path) -> (centers, scales, quats, opacity, meta)`).
- Produces: `records.flags_for(...) -> (N,) uint8`; `records.transfer(src_pos, src_values, dst_pos, k) -> values`; `reference.Model`, `reference.Setting` (with `captured`, `with_sky`, `with_lamps`), `reference.multiplier(direct, normals, flags, pos, colour_lin, model, setting) -> (rgb (N,3), alpha (N,))`; `package.write(...)`; the package in `<out>`; `<evidence>/checks.json`; the R1b fixture.

- [ ] **Step 1: Write the failing tests for the reference multiplier**

`tools/relight/tests/test_reference.py`:

```python
import unittest
import numpy as np
from relight import codec, reference


def model(n_probes_axis=2):
    shape = (n_probes_axis,) * 3
    M = int(np.prod(shape))
    cubes = np.zeros((M, 9, 3, 6), np.float32)
    cubes[:, 5] = 0.1                                       # the cove bounces a little everywhere
    return reference.Model(
        capture_w=np.array([1.0, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5]),
        capture_c=np.tile([1.0, 1.0, 1.0], (9, 1)),
        daylight_colour=np.array([1.0, 1.0, 1.0]),
        probes=cubes, probe_valid=np.ones(M, bool), probe_origin=np.zeros(3), probe_spacing=1.0, probe_shape=shape,
        windows={}, fresnel=np.ones(101, np.float32), sun_beta=0.0, sky_flux=np.ones(5))


def splats(n=4):
    direct = np.zeros((n, 9)); direct[:, 0] = 1.0; direct[:, 5] = 0.5
    normals = np.tile([0.0, 0.0, 1.0], (n, 1))
    flags = np.zeros(n, np.uint8)
    pos = np.full((n, 3), 0.5)
    colour = np.full((n, 3), 0.4)
    return direct, normals, flags, pos, colour


class CapturedSettingIsNeutral(unittest.TestCase):
    def test_multiplier_is_one_at_the_captured_light(self):
        m = model()
        rgb, alpha = reference.multiplier(*splats(), m, reference.Setting.captured(m))
        self.assertTrue(np.allclose(rgb, 1.0, atol=1e-6))
        self.assertTrue(np.all(alpha == 1.0))


class Rules(unittest.TestCase):
    def test_night_without_sky_keeps_only_lamp_light(self):
        m = model()
        rgb, _ = reference.multiplier(*splats(), m, reference.Setting.captured(m).with_sky(0.0))
        # captured: W1 1.0 + cove (0.5 direct + 0.1 bounce) x 0.5 = 1.3; night: 0.3
        self.assertTrue(np.allclose(rgb, 0.3 / 1.3, atol=1e-5))

    def test_multiplier_is_clamped(self):
        m = model()
        rgb, _ = reference.multiplier(*splats(), m, reference.Setting.captured(m).with_sky(100.0))
        self.assertTrue(np.all(rgb <= 8.0 + 1e-9))

    def test_hidden_splats_have_zero_alpha(self):
        m = model()
        d, n, f, p, c = splats()
        f[1] = codec.CLASS_HIDDEN
        _, alpha = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m))
        self.assertEqual(alpha.tolist(), [1.0, 0.0, 1.0, 1.0])

    def test_lit_bulbs_are_boosted_and_unlit_bulbs_reflect(self):
        m = model()
        d, n, f, p, c = splats()
        f[:] = codec.CLASS_CH_EMITTER
        c[:] = 0.95                                        # a bright bulb: 1 + (4 - 1) x smoothstep(0.45, 0.9, L) = 4
        on, _ = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m).with_lamps(1.0).with_emitter_boost(4.0))
        self.assertTrue(np.allclose(on, 4.0, atol=1e-6))
        neutral, _ = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m))
        self.assertTrue(np.allclose(neutral, 1.0, atol=1e-6))      # the captured setting leaves bulbs as captured
        off, _ = reference.multiplier(d, n, f, p, c, m, reference.Setting.captured(m).with_lamps(0.0))
        self.assertTrue(np.all(off < 1.0))

    def test_the_horizon_blocks_the_sun(self):
        from dataclasses import replace
        from relight import windows
        def plane(y):
            return windows.Plane(origin=np.array([0.0, y, 3.0]), u=np.array([1.0, 0, 0]), v=np.array([0, 0, -1.0]),
                                 width=2.0, height=2.0, normal=np.array([0, -1.0, 0]), stencil=np.ones((10, 10), np.float32))
        base = model()
        site = (np.array([0, -1.0, 0]), np.array([1.0, 0, 0]), np.array([0, 0, 1.0]))   # north = out of the window
        s = np.array([0.0, -0.995, 0.0995]); s /= np.linalg.norm(s)                     # azimuth 0, elevation 5.7 deg
        d, n, f, p, c = splats(1)
        n[:] = [0.0, -1.0, 0.0]; f[:] = codec.FLAG_SUN; p[:] = [1.0, 1.0, 2.0]
        setting = replace(reference.Setting.captured(base), sun_dir=s, sun_rgb=np.ones(3))
        open_m = replace(base, windows={"W1": (plane(0.0), plane(-0.5))}, horizons={"W1": np.zeros(360)}, site=site)
        shut_m = replace(open_m, horizons={"W1": np.full(360, 90.0)})
        lit, _ = reference.multiplier(d, n, f, p, c, open_m, setting)
        shut, _ = reference.multiplier(d, n, f, p, c, shut_m, setting)
        self.assertTrue(np.all(lit > 1.0 + 1e-3))
        self.assertTrue(np.allclose(shut, 1.0, atol=1e-9))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_reference -v`
Expected: FAIL, no module `relight.reference`.

- [ ] **Step 3: Write the reference multiplier**

`tools/relight/relight/reference.py`:

```python
"""The normative relight multiplier (the plan's section "The multiplier"), in numpy.

The browser's GPU kernel (plan R1b) must match this within the codec's precision; the test
vectors written by `python -m relight check` hold both inputs and expected outputs."""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np

from . import codec
from .probes import sun_bounce_weights_from_area
from .windows import visibility

LUMW = np.array([0.2126, 0.7152, 0.0722])
WINDOWS = ("W1", "W2", "W3", "W4", "W5")
LAMP_GROUPS = ("cove", "ch_end", "ch_centre", "dome")


@dataclass(frozen=True)
class Model:
    capture_w: np.ndarray        # (9,)
    capture_c: np.ndarray        # (9, 3)
    daylight_colour: np.ndarray  # (3,) the capture's daylight colour, c[W1]
    probes: np.ndarray           # (M, 9, 3, 6)
    probe_valid: np.ndarray      # (M,) bool
    probe_origin: np.ndarray     # (3,)
    probe_spacing: float
    probe_shape: tuple
    windows: dict                # name -> (inner Plane, glass Plane); empty = no sun
    fresnel: np.ndarray          # (101,)
    sun_beta: float
    sky_flux: np.ndarray         # (5,)
    horizons: dict = field(default_factory=dict)   # name -> (360,) horizon elevation in degrees by azimuth
    site: tuple | None = None    # (north, east, up) unit vectors in the model frame


@dataclass(frozen=True)
class Setting:
    weights: np.ndarray          # (9, 3): each source's weight x colour
    sky_level: float
    sky_colour: np.ndarray       # (3,)
    lamp_levels: dict            # group -> level 0..1
    sun_dir: np.ndarray | None   # (3,) toward the sun, model frame
    sun_rgb: np.ndarray          # (3,)
    emitter_boost: float = 1.0   # 1 at the captured setting; 4 for the proof's night with the lamps lit

    @staticmethod
    def captured(model: Model) -> "Setting":
        return Setting(weights=model.capture_w[:, None] * model.capture_c, sky_level=1.0,
                       sky_colour=np.asarray(model.daylight_colour, np.float64).copy(),
                       lamp_levels={g: 1.0 for g in LAMP_GROUPS}, sun_dir=None, sun_rgb=np.zeros(3), emitter_boost=1.0)

    def with_sky(self, level: float) -> "Setting":
        w = self.weights.copy()
        w[:5] = w[:5] * (level / self.sky_level) if self.sky_level > 0 else w[:5] * 0.0
        return replace(self, weights=w, sky_level=level)

    def with_lamps(self, level: float) -> "Setting":
        return replace(self, lamp_levels={g: level for g in LAMP_GROUPS})

    def with_emitter_boost(self, boost: float) -> "Setting":
        return replace(self, emitter_boost=boost)


def trilinear(model: Model, pos):
    """Corner indices (N, 8) and weights (N, 8) over valid probes, renormalised (03_bases.trilinear_weights)."""
    shape = np.array(model.probe_shape)
    q = (np.asarray(pos, np.float64) - model.probe_origin) / model.probe_spacing
    q = np.clip(q, 0.0, shape - 1 - 1e-6)
    i0 = np.floor(q).astype(np.int64)
    f = q - i0
    idx, wts = [], []
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                c = np.minimum(i0 + [dx, dy, dz], shape - 1)
                lin = (c[:, 0] * shape[1] + c[:, 1]) * shape[2] + c[:, 2]
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                idx.append(lin); wts.append(w * model.probe_valid[lin])
    idx, wts = np.stack(idx, 1), np.stack(wts, 1)
    s = wts.sum(1, keepdims=True)
    return idx, np.where(s > 0, wts / np.maximum(s, 1e-12), 0.0)


def cube_eval(cubes, n, iso):
    """cubes (N, K, 3, 6), n (N, 3), iso (N,) -> (N, K, 3), as lt.cube_eval."""
    nx, ny, nz = n[:, 0], n[:, 1], n[:, 2]
    w = np.stack([np.clip(nx, 0, None) ** 2, np.clip(-nx, 0, None) ** 2, np.clip(ny, 0, None) ** 2,
                  np.clip(-ny, 0, None) ** 2, np.clip(nz, 0, None) ** 2, np.clip(-nz, 0, None) ** 2], 1)
    e = (cubes * w[:, None, None, :]).sum(-1)
    return np.where(iso[:, None, None], cubes.mean(-1), e)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def fresnel_at(model: Model, s) -> float:
    return float(model.fresnel[int(round(min(abs(float(s[1])), 1.0) * 100))])


def above_horizon(model: Model, name: str, s) -> bool:
    """True when the sun clears window `name`'s horizon (no horizon data: always true)."""
    if name not in model.horizons or model.site is None:
        return True
    north, east, up = (np.asarray(v, np.float64) for v in model.site)
    s = np.asarray(s, np.float64)
    el = float(np.degrees(np.arcsin(np.clip(s @ up, -1.0, 1.0))))
    az = float(np.degrees(np.arctan2(s @ east, s @ north))) % 360.0
    return el > float(model.horizons[name][int(round(az)) % 360])


def sunlit_glass_area(model: Model, s) -> np.ndarray:
    """(5,): each window's glass area lit through both stencils, times the cosine to the wall normal."""
    area = np.zeros(5)
    for w, name in enumerate(WINDOWS):
        planes = model.windows.get(name)
        if planes is None or not above_horizon(model, name, s):
            continue
        inner, glass = planes
        h, wd = glass.stencil.shape
        a = (np.arange(wd) + 0.5) / wd * inner.width
        b = (np.arange(h) + 0.5) / h * inner.height
        A_, B_ = np.meshgrid(a, b)
        P = inner.origin + A_.reshape(-1, 1) * inner.u + B_.reshape(-1, 1) * inner.v - 0.01 * inner.normal
        cell = (inner.width / wd) * (inner.height / h)
        area[w] = float(visibility(planes, P, s).sum()) * cell * max(float(np.asarray(s) @ inner.normal), 0.0)
    return area


def multiplier(direct, normals, flags, pos, colour_lin, model: Model, setting: Setting):
    direct = np.asarray(direct, np.float64)
    n = np.asarray(normals, np.float64)
    flags = np.asarray(flags, np.uint8)
    C = np.asarray(colour_lin, np.float64)
    cls = flags & codec.CLASS_MASK
    iso = (flags & codec.FLAG_ISO) > 0
    idx, wts = trilinear(model, pos)
    cubes = (model.probes[idx].astype(np.float64) * wts[:, :, None, None, None]).sum(1)   # (N, 9, 3, 6)
    I = cube_eval(cubes, n, iso)                                                          # (N, 9, 3)
    light = direct[:, :, None] + I
    Ecap = (light * (model.capture_w[:, None] * model.capture_c)[None]).sum(1)
    E = (light * setting.weights[None]).sum(1)
    if setting.sun_dir is not None and model.windows:
        s = np.asarray(setting.sun_dir, np.float64)
        reach = (flags & codec.FLAG_SUN) > 0
        vis = np.zeros(len(n))
        if reach.any():
            vis[reach] = sum(visibility(planes, np.asarray(pos)[reach], s)
                             for name, planes in model.windows.items() if above_horizon(model, name, s))
        vis *= fresnel_at(model, s)
        cosv = np.where(iso, 0.25, np.clip(n @ s, 0, None))
        E = E + (vis * cosv)[:, None] * setting.sun_rgb[None]
        b = sun_bounce_weights_from_area(sunlit_glass_area(model, s) * fresnel_at(model, s), model.sky_flux, model.sun_beta)
        E = E + (I[:, :5, :] * b[None, :, None]).sum(1) * setting.sun_rgb[None]
    L = C @ LUMW
    M = E / np.maximum(Ecap, 1e-4)
    emb = cls == codec.CLASS_EMBRASURE
    if emb.any():
        rho = np.minimum(C[emb] / np.maximum(Ecap[emb], 1e-4), 0.8)
        excess = np.maximum(C[emb] - rho * Ecap[emb], 0.0)
        r_back = setting.sky_level * setting.sky_colour / np.maximum(model.daylight_colour, 1e-6)
        M[emb] = (rho * E[emb] + excess * r_back[None]) / np.maximum(C[emb], 1e-4)
    M = np.clip(M, 1 / 16, 8.0)
    fx = np.isin(cls, [codec.CLASS_CH_EMITTER, codec.CLASS_DOME_EMITTER, codec.CLASS_COVE, codec.CLASS_CH_FIXTURE])
    if fx.any():
        centre = (flags & codec.FLAG_CH_CENTRE) > 0
        group = np.where(cls == codec.CLASS_DOME_EMITTER, "dome",
                         np.where(cls == codec.CLASS_COVE, "cove", np.where(centre, "ch_centre", "ch_end")))
        level = np.array([setting.lamp_levels[g] for g in group[fx]])[:, None]
        c_fx = cls[fx]
        bulb = np.isin(c_fx, [codec.CLASS_CH_EMITTER, codec.CLASS_DOME_EMITTER])[:, None]
        cove = (c_fx == codec.CLASS_COVE)[:, None]
        lit = np.where(bulb, (1.0 + (setting.emitter_boost - 1.0) * smoothstep(0.45, 0.9, L[fx]))[:, None], np.where(cove, 1.0, M[fx]))
        chroma = np.clip(C[fx] / np.maximum(L[fx], 1e-4)[:, None], 0.5, 2.0) ** 0.4
        A = np.where((c_fx == codec.CLASS_DOME_EMITTER)[:, None], 0.5, 0.35) * chroma
        A = np.where(cove, 0.3, A)
        unlit = A * E[fx] / np.maximum(C[fx], 1e-4)
        M[fx] = np.clip(level * lit + (1 - level) * unlit, 0.0, 8.0)
    alpha = np.where(cls == codec.CLASS_HIDDEN, 0.0, 1.0)
    return M, alpha
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_reference -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the records and transfer, with tests**

`tools/relight/tests/test_records.py`:

```python
import unittest
import numpy as np
from relight import codec, records


class Flags(unittest.TestCase):
    def test_flags_pack_class_iso_reach_and_group(self):
        f = records.flags_for(cls=np.array([0, 1, 2, 3, 3, 4]), iso=np.array([1, 0, 0, 0, 0, 0], bool),
                              reach=np.array([1, 1, 0, 0, 0, 0], bool), chand_id=np.array([-1, -1, -1, 0, 4, -1]),
                              centre_ids=(4,), cove=np.zeros(6, bool), fixture=np.zeros(6, bool), pane=np.zeros(6, bool))
        self.assertEqual(int(f[0]), codec.CLASS_INTERIOR | codec.FLAG_ISO | codec.FLAG_SUN)
        self.assertEqual(int(f[1]) & codec.CLASS_MASK, codec.CLASS_EMBRASURE)
        self.assertEqual(int(f[2]) & codec.CLASS_MASK, codec.CLASS_HIDDEN)
        self.assertEqual(int(f[3]), codec.CLASS_CH_EMITTER)
        self.assertEqual(int(f[4]), codec.CLASS_CH_EMITTER | codec.FLAG_CH_CENTRE)
        self.assertEqual(int(f[5]) & codec.CLASS_MASK, codec.CLASS_DOME_EMITTER)

    def test_pane_haze_is_hidden_and_the_cove_strip_is_its_own_class(self):
        f = records.flags_for(cls=np.array([1, 0]), iso=np.zeros(2, bool), reach=np.zeros(2, bool), chand_id=np.array([-1, -1]),
                              centre_ids=(4,), cove=np.array([False, True]), fixture=np.zeros(2, bool), pane=np.array([True, False]))
        self.assertEqual(int(f[0]) & codec.CLASS_MASK, codec.CLASS_HIDDEN)
        self.assertEqual(int(f[1]) & codec.CLASS_MASK, codec.CLASS_COVE)


class Transfer(unittest.TestCase):
    def test_transfer_takes_the_nearest_values(self):
        src = np.array([[0.0, 0, 0], [10.0, 0, 0]]); vals = np.array([[1.0], [3.0]])
        out = records.transfer(src, vals, np.array([[0.1, 0, 0], [9.8, 0, 0]]), k=1)
        self.assertEqual(out[:, 0].tolist(), [1.0, 3.0])

    def test_transfer_blends_by_inverse_distance(self):
        src = np.array([[0.0, 0, 0], [2.0, 0, 0]]); vals = np.array([[1.0], [3.0]])
        out = records.transfer(src, vals, np.array([[1.0, 0, 0]]), k=2)
        self.assertAlmostEqual(float(out[0, 0]), 2.0, places=6)


if __name__ == "__main__":
    unittest.main()
```

`tools/relight/relight/records.py`:

```python
"""Per-splat records: the finest level from the light model's tables, coarser levels by transfer."""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

from . import codec


def flags_for(cls, iso, reach, chand_id, centre_ids, cove, fixture, pane):
    """Model classes (0 interior, 1 embrasure, 2 exterior, 3 chandelier bulb, 4 dome lamp) to record flags."""
    c = np.asarray(cls).astype(np.uint8).copy()
    c[np.asarray(fixture) & (c <= 1)] = codec.CLASS_CH_FIXTURE
    c[np.asarray(cove)] = codec.CLASS_COVE
    c[np.asarray(pane)] = codec.CLASS_HIDDEN
    f = c.astype(np.uint8)
    f |= np.where(np.asarray(iso), codec.FLAG_ISO, 0).astype(np.uint8)
    f |= np.where(np.asarray(reach), codec.FLAG_SUN, 0).astype(np.uint8)
    centre = np.isin(np.asarray(chand_id), centre_ids) & np.isin(c, [codec.CLASS_CH_EMITTER, codec.CLASS_CH_FIXTURE])
    f |= np.where(centre, codec.FLAG_CH_CENTRE, 0).astype(np.uint8)
    return f


def transfer(src_pos, src_values, dst_pos, k=8):
    """Inverse-distance blend of the k nearest source splats' values (for the coarser levels)."""
    tree = cKDTree(np.asarray(src_pos, np.float64))
    d, i = tree.query(np.asarray(dst_pos, np.float64), k=k)
    v = np.asarray(src_values)
    if k == 1:
        return v[i]
    w = 1.0 / np.maximum(d, 1e-4)
    w /= w.sum(1, keepdims=True)
    return (v[i] * w[..., None]).sum(1)
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_records -v`
Expected: PASS, 4 tests.

- [ ] **Step 6: Build the records and the package**

`tools/relight/relight/package.py` writes every file of `docs/engineering/relight-package.md` into `cfg.paths["out"]`: per served tile the gzip of its records (`gzip.compress(data, compresslevel=9, mtime=0)` so the bytes are deterministic), `probes.bin.gz` (the coarse cubes as `<f2` in `[probe][source][channel][face]` order), `probe-valid.bin.gz`, the ten stencils as 8-bit PNGs (`round(T × 255)`), the three floor light PNGs (RGBA8 log codes per `encoding.floor`), and `manifest.json` with every contract field and a SHA-256 and size per file (`json.dumps(..., indent=1, sort_keys=True)`).

Register a `records` command that:

1. Loads the Task 2 tables (memory-mapped) and computes per finest-level splat, in chunks: `direct` (N, 9) from the proof's `04_fit.direct(store, idx)` (ten bases; keep the columns W1..W5, cove, ch_end, ch_centre, dome in that order and drop `sun_cap`, whose fitted weight is 0), with the embrasure room-side and back-face light that `03c`/`03d` produce folded into the window columns exactly as `04_fit.direct` already combines them for class 1; normals `bases_n` (e57 frame); `iso` from `bases_iso`; exterior and pane haze from `05_relight.exterior_masks`; the cove strip from `05_relight.cove_strip`; `fixture` = `geom_chand_id >= 0` with class 0; the centre chandelier's id as `03_bases.py` assigns it to `E_ch` column 1; and `reach` = `windows.sun_reach` over `windows.sun_directions(common.solar_position, common.sun_vec_e57)` for classes 0 and 1 only (numpy; no GPU lock needed).
2. Splits them per finest tile with `splats_tile` (the order of `cfg.room["finestTiles"]`); `ranges = [codec.source_range(direct[:, k]) for k in range(9)]` over all finest splats.
3. For each of the other 12 served tiles (every `*.sog` in `cfg.paths["splats"]` not in `finestTiles`): decode the centres with `decode_tile`, convert them to e57 with `common.json_to_e57`, then transfer `direct` (k = `cfg.room["transferNeighbours"]`, 8) and, with k = 1, the normals, class, iso, reach, chandelier id, cove, fixture and pane values; recompute the flags with `flags_for`.
4. Writes the package with `package.write`, with `site.north = common.sun_vec_e57(0, 0)`, `site.east = common.sun_vec_e57(90, 0)` and `site.up = [0, 0, 1]` (so the browser's sun matches the proof's), and each window's horizon table from `windows.npz`; the manifest's `tiles` list holds each tile's name, the SHA-256 of the `.sog` file, its level (from the bundle file: 5 for the finest, `null` for `env.sog`), count, file, SHA-256 and size.

Run: `C:/Python313/python.exe -m relight records --config config/grand-hall.json`
Expected: `D:/claude/splats/trades-hall/grand-hall/relight/v1/` holds `manifest.json`, 24 `tiles/*.relight.gz`, `probes.bin.gz`, `probe-valid.bin.gz`, 10 stencils and 3 floor maps; the tile counts sum to 11,487,038.

- [ ] **Step 7: Run the checks and write the test vectors**

Register a `check` command that reads the package back from disk (never in-memory arrays) and writes `<evidence>/checks.json`:

1. **Captured identity:** for every tile, `reference.multiplier` at `Setting.captured(model)` gives |log2 M| ≤ 0.05 for at least 99.9% of non-hidden splats.
2. **Proof regression:** for the finest level, `reference.multiplier` for the proof's `night` and `overcast_noon` settings (built from `05_relight.SCENARIOS` and `scenario_light`: window weights `W[w] × sky` with `col_sky`, lamp weights `house × WC`) against the proof's own `proofWork/mult/night.f16` and `overcast_noon.f16` (N × 4 float16, product order): median |Δlog2| ≤ 0.1 and 95th percentile ≤ 0.3 over interior splats (class 0, not in a chandelier). For `sunny_morning`: median ≤ 0.25.
3. **Transfer:** for each coarser tile, the median |Δlog2| between a coarse splat's night multiplier and its nearest finest splat's ≤ 0.1.
4. **Determinism:** writing the package a second time into a temporary folder on D: gives byte-identical files.

Then write `packages/web/src/lib/relight/__fixtures__/relight-vectors.json` in exactly the shape of `RelightVectorsSchema` (schema `venviewer.relight-vectors.v1`) defined in plan R1b's Task 4, `docs/superpowers/plans/2026-09-29-restored-hall-r1b-relit-browser.md`: read that block and the helper schemas above it before writing, and include each setting's `emitterBoost` (1 for `captured`, 4 for `night`) and the horizon tables. Its content: 64 finest-level splats chosen across classes (16 interior, 16 embrasure, 8 bulbs, 8 fixtures and cove, 8 sun-reachable floor, 8 hidden), each with its 12-byte record (hex), position (e57), captured linear colour and the expected `M`, `alpha` and packed `uint32` for three settings (`captured`, `night`, `sunny_morning` with its sun direction and RGB); plus what the kernel needs from the manifest (encoding ranges, capture weights and colours, the probe block around those splats with its origin, the Fresnel table, the five windows' planes with stencils as base64 PNGs, `beta`, `skyFlux`). Keep it under 400 kB. Record `capturedIdentity`, `proofRegression`, `transfer` and `determinism` in the manifest's `evidence` too.

Run: `C:/Python313/python.exe -m relight check --config config/grand-hall.json`
Expected: `checks.json` with all four `pass: true`, and the fixture written. If a check fails, stop and report the numbers.

- [ ] **Step 8: Commit**

```bash
cd D:/claude/real-hall/repo
git add tools/relight/relight/records.py tools/relight/relight/reference.py tools/relight/relight/package.py tools/relight/relight/__main__.py tools/relight/tests/test_reference.py tools/relight/tests/test_records.py packages/web/src/lib/relight/__fixtures__/relight-vectors.json
git diff --cached --stat
git commit -m "feat(relight): records for all 24 tiles, the reference multiplier, checks and test vectors (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The restored floor (floor skin v2)

**Files:**
- Modify: `tools/floor-skin/build_floor_skin.py`, `tools/floor-skin/README.md`

**Interfaces:**
- Consumes: `D:/claude/real-hall/renovation/floor/floor_restored_albedo_2mm.png` and `floor_restored_albedo_mask.png` (the prototype; same grid and mask as Arm C); the fitted floor albedo (`<work>/fit.json`, `group_albedo_mean` for `floor`).
- Produces: floor skin v2 at `D:/claude/splats/trades-hall/grand-hall/floor-skin/v2/`: `provenance.kind = "restored-albedo"`, `provenance.arm = "R"`, the same `grid`, `plane`, `tiles`, `height` and `slab` as v1, and `colour.albedoScale` (the calibration factor, for R1b).

- [ ] **Step 1: Add arm R and the calibration**

In `tools/floor-skin/build_floor_skin.py`, add to `ARMS`:

```python
        "R": ("floor_R_restored_2mm.png", "floor_R_restored_mask.png", "Arm C restored: delit, evened, healed, refinished (renovation, T-639)")}
```

and an option `--albedo-luminance <float>`. With arm R it scales the texture in linear light so its mean luminance over the mask equals that value before the tiers are encoded, writes `"kind": "restored-albedo"` in `provenance`, and writes `"albedoScale": <factor>` in `colour`. Arms A, B and C are unchanged (`kind` stays `"measured-photographic"`). If the manifest schema in `packages/web/src/lib/floor-skin.ts` only admits `"measured-photographic"`, leave that file for R1b (which reads v2) and note it in the task report.

- [ ] **Step 2: Build v2**

Prepare the input folder that the prototype's README ("Plugging into the floor-skin package") describes: the restored PNG and mask under the arm R names, next to copies of the Arm C inputs' `floor.json` and `floor_height_resid_5cm.png`. Compute the target luminance from `fit.json` (`group_albedo_mean["floor"]` · (0.2126, 0.7152, 0.0722); 0.3218 for the proof's `[0.342, 0.318, 0.348]`), then run:

```bash
cd D:/claude/real-hall/repo && C:/Python313/python.exe tools/floor-skin/build_floor_skin.py --arm R --room grand-hall --floor D:/claude/relight/grand-hall/floor-R-inputs --out D:/claude/splats/trades-hall/grand-hall/floor-skin/v2 --albedo-luminance 0.3218
```

Expected: v2 written; the builder's slab-mask check passes (the mask equals Arm C's); `floor-skin.json` (the builder's manifest name) shows arm R, `restored-albedo` and the scale.

- [ ] **Step 3: Document and commit**

Add arm R to `tools/floor-skin/README.md`: the restored albedo is not a photograph and needs live light (R1b), and the `?floor=matched` ratio does not apply to it.

```bash
cd D:/claude/real-hall/repo
git add tools/floor-skin/build_floor_skin.py tools/floor-skin/README.md
git diff --cached --stat
git commit -m "feat(floor-skin): arm R, the restored albedo calibrated to the fitted floor (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Stage, publish and record

**Files:**
- Create: `tools/relight/README.md`
- Modify: the day's session log under `docs/sessions/`, `docs/state/tasks.md` (T-639 row)

- [ ] **Step 1: Write the README**

`tools/relight/README.md`: what the bake makes (link the contract), the commands in order (`proof all`, `windows`, `check-stencils`, `probes`, `floor`, `records`, `check`), the GPU-lock and D: rules, each step's time on this PC (from the logs), and how to publish.

- [ ] **Step 2: Teach the publisher nested package folders**

The relight package has subfolders (`tiles/`, `windows/`, `floor/`), and `packages/api/src/scripts/publish-splat-tiles.ts --package` today collects only the files directly inside the version folder. Read the script's `--package` path and its test file `packages/api/src/scripts/__tests__/publish-splat-tiles.test.ts` first, then test first:

1. Add tests: a package folder with `manifest.json`, `tiles/a.relight.gz` and `windows/W1-glass.png` publishes all three under the prefix with their relative paths (`<prefix>/tiles/a.relight.gz`); `.gz` objects are uploaded with `Content-Type: application/octet-stream` and no `Content-Encoding` (the browser gunzips them itself; a `Content-Encoding: gzip` header would make the browser decompress twice); `.png` gets `image/png` and `.json` `application/json`; every object keeps the immutable cache header the script already sets.
2. Run them and see them fail: `pnpm --filter @omnitwin/api exec vitest run src/scripts/__tests__/publish-splat-tiles.test.ts`.
3. Make the file collection recursive (relative paths with `/` separators) and the content types as above, changing nothing else.
4. Run the same command and see them pass; commit with explicit pathspecs.

- [ ] **Step 3: Publish both packages to R2**

The R2 credentials stay in `packages/api/.env`, so run this worktree's publisher script (the one Step 2 changed) with the working directory set to the shared checkout's `packages/api`, where the script reads `.env` in place, as I1a did; never copy `.env`. Use the flags `tools/floor-skin/README.md` documents for publishing a package version (`--package` with the staged folder and the R2 prefix); the publisher refuses to overwrite an existing version. Publish `D:/claude/splats/trades-hall/grand-hall/relight/v1` to `splats/trades-hall/grand-hall/relight/v1`, and `…/floor-skin/v2` to `splats/trades-hall/grand-hall/floor-skin/v2`. Then check one file of each:

```bash
curl -sI https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats/trades-hall/grand-hall/relight/v1/manifest.json | grep -iE "^HTTP|content-type|cache-control"
curl -sI https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev/splats/trades-hall/grand-hall/floor-skin/v2/manifest.json | grep -iE "^HTTP|content-type|cache-control"
```

Expected: 200, a JSON content type, immutable caching.

- [ ] **Step 4: Record and commit**

Add a section to the day's session log: what was baked, the six checks with their numbers (stencil sun, sun bounce, captured identity, proof regression, transfer, determinism), sizes and times, and the R2 paths. Update T-639's row in `docs/state/tasks.md` (R1a done; R1b next).

```bash
cd D:/claude/real-hall/repo
git add tools/relight/README.md docs/sessions docs/state/tasks.md
git diff --cached --stat
git commit -m "docs(relight): the Grand Hall light bake, its checks and where it is published (T-639 R1a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin claude/real-hall
```

---

## Self-review notes

- Spec coverage: §4.1 sources, stencils, captured light and lamp colour → Tasks 2, 3, 5; §4.2 records, probes and manifest (including the data the browser needs to refuse a mismatched package: `tileSha256` and counts) → Tasks 1, 4, 5; the floor's restored albedo and its light → Tasks 4, 6; §6 unit tests (codec, stencils, probes, reference) and the photo-anchored regression against the proof → Tasks 1, 3, 4, 5 (R1b compares with the photographs directly); §8 package size and build-PC rules → Global Constraints and Task 5. The browser (§4.3, the §4.4 web units, §5 and the rest of §6) is plan R1b.
- The section "The multiplier" is normative for both plans and matches `reference.py` line for line.
