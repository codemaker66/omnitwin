# R1c's amendments to the R1a and R1b plans (T-639, 3–7 October)

R1c ("surface skins", `docs/superpowers/plans/2026-10-03-restored-hall-r1c-surface-skins.md`) builds on R1a and R1b as these amendments leave them. Apply them in one pass, together with R1d's (`docs/superpowers/plans/2026-10-03-r1d-amendments-to-r1a-r1b.md`), before R1a Task 5 is dispatched. Where R1d's amendments touch the same lines (marked **Overlap**), apply both: the result keeps R1d's change and R1c's.

The amendments take three forms:

- **R1a Tasks 1–4 are committed code** (`ec4dd7bf`, `0b4b6f2b`, `4f722bf4`, `a2a25c56`, `deed4d4a`). Amendments to them (A1's Python part, A4) are edits to the files in `tools/relight/`, each with its tests, committed as one R1a follow-up commit.
- **R1a Tasks 5–7 and all of R1b are plan text.** Their amendments are literal replacements in the named plan ("Replace … with …") or literal additions ("Add … directly after …").
- **The contract `docs/engineering/relight-package.md`** gains text in A1 and A5, applied when the plans are amended.

R1c's Task 0 checks each amendment by name (17 greps); the list is at the end.

Sections:

- A1 record classes and toggles
- A2 visibility in the normative multiplier
- A3 covers and toggles in the records
- A4 the skins' light (`skin-light`)
- A5 relight package v2
- A6 the kernel's visibility (R1b)
- A7 the manifest's sections (R1b)
- A8 the shared bounce and extra passes (R1b)
- A9 the frame's visibility and the multiplier's alpha (R1b)
- A10 the debug sample and the one preview (R1b)

Plans: **R1a** = `docs/superpowers/plans/2026-09-29-restored-hall-r1a-light-bake.md`; **R1b** = `docs/superpowers/plans/2026-09-29-restored-hall-r1b-relit-browser.md`.

Why. The skins replace the wall and ceiling splats they cover, per wall group, and the toggleable objects (two loudspeakers, the AV cabinet) are splats hidden on request. Both are decisions per splat, so they belong in the records the multiplier already reads. A covered splat keeps its light: it is lit exactly as an interior splat, so a group whose skins fail falls back to splats that look as before. The skins' own light comes from the same bake, the same nine sources and the same bounce, so a skin and its neighbouring splats agree at every setting.

---

## A1. Record classes and toggles

The flags byte today: bits 0–2 class 0–6, bit 3 isotropic, bit 4 sun-reachable, bit 5 chandelier centre (classes 3 and 6 only). R1c adds:

- **class 7**, a splat a skin covers. Its wall group goes in bits 5–7 (0 door wall, 1 window wall, 2 `end_xmin`, 3 `end_xmax`, 4 ceiling; 5–6 spare; 7 reserved). Bits 3 and 4 are kept. A class-7 flags byte is at most `7 | 8 | 16 | 6 << 5 = 223`, never R1b's pass-through `0xff`.
- **a toggle** in bits 6–7 of any other class: 0 none, 1 the loose clutter, 2 the AV cabinet. Bit 5 keeps its meaning for the chandelier classes.

**R1a, code `tools/relight/relight/codec.py`.** Directly after `FLAG_CH_CENTRE = 1 << 5` add:

```python

# Skins (R1c, amendment A1): a splat a skin covers is class 7, its wall group in bits 5-7 (0 door wall, 1 window wall,
# 2 end_xmin, 3 end_xmax, 4 ceiling; 7 reserved, so no record's flags byte is R1b's pass-through 0xff), lit exactly as
# class 0 and hidden while its group's skins draw. Any other class may carry a toggle in bits 6-7 (bit 5 stays the
# chandelier group): 1 the loose clutter, 2 the AV cabinet; a toggled splat is hidden while its toggle is.
CLASS_SKIN = 7
SKIN_GROUP_SHIFT = 5
SKIN_GROUP_MAX = 6
TOGGLE_SHIFT = 6
TOGGLE_NONE, TOGGLE_CLUTTER, TOGGLE_CABINET = 0, 1, 2
```

and directly after the function `unpack_records` add:

```python


def cover_flags(flags, group):
    """Class 7 in wall group `group` for the interior splats (class 0) among `flags`, ISO and SUN kept; others unchanged."""
    f = np.asarray(flags, dtype=np.uint8)
    g = np.broadcast_to(np.asarray(group, dtype=np.int64), f.shape)
    if (g < 0).any() or (g > SKIN_GROUP_MAX).any():
        raise ValueError("a wall group is 0..6")
    covered = (f & CLASS_MASK) == CLASS_INTERIOR
    out = (f & (FLAG_ISO | FLAG_SUN)) | CLASS_SKIN | (g.astype(np.uint8) << SKIN_GROUP_SHIFT)
    return np.where(covered, out, f).astype(np.uint8)


def toggle_flags(flags, toggle):
    """The toggle in bits 6-7 of every splat that is not class 7 (whose bits 5-7 hold its wall group)."""
    f = np.asarray(flags, dtype=np.uint8)
    t = np.broadcast_to(np.asarray(toggle, dtype=np.int64), f.shape)
    if (t < 0).any() or (t > 3).any():
        raise ValueError("a toggle is 0..3")
    skin = (f & CLASS_MASK) == CLASS_SKIN
    return np.where(skin, f, (f & 0b0011_1111) | (t.astype(np.uint8) << TOGGLE_SHIFT)).astype(np.uint8)


def skin_group_of(flags):
    f = np.asarray(flags, dtype=np.uint8)
    return np.where((f & CLASS_MASK) == CLASS_SKIN, f >> SKIN_GROUP_SHIFT, -1).astype(np.int64)


def toggle_of(flags):
    f = np.asarray(flags, dtype=np.uint8)
    return np.where((f & CLASS_MASK) == CLASS_SKIN, 0, f >> TOGGLE_SHIFT).astype(np.int64)
```

Create `tools/relight/tests/test_codec_skins.py`:

```python
import unittest
import numpy as np
from relight import codec


class Skins(unittest.TestCase):
    def test_cover_flags_make_interior_splats_class_7_in_their_group(self):
        f = np.array([0, codec.FLAG_ISO | codec.FLAG_SUN, codec.CLASS_EMBRASURE, codec.CLASS_CH_EMITTER | codec.FLAG_CH_CENTRE], np.uint8)
        out = codec.cover_flags(f, np.array([4, 6, 1, 2]))
        self.assertEqual(int(out[0]), 7 | (4 << 5))
        self.assertEqual(int(out[1]), 7 | codec.FLAG_ISO | codec.FLAG_SUN | (6 << 5))
        self.assertEqual(out[2:].tolist(), f[2:].tolist())
        self.assertEqual(codec.skin_group_of(out).tolist(), [4, 6, -1, -1])
        self.assertLess(int(out.max()), 0xff)
        with self.assertRaises(ValueError):
            codec.cover_flags(f, 7)

    def test_toggles_keep_class_and_flags_and_skip_covered_splats(self):
        f = np.array([0, codec.CLASS_CH_EMITTER | codec.FLAG_CH_CENTRE, 7 | (2 << 5)], np.uint8)
        out = codec.toggle_flags(f, 2)
        self.assertEqual(int(out[0]), 2 << 6)
        self.assertEqual(int(out[1]) & 0b0011_1111, int(f[1]))
        self.assertEqual(int(out[2]), int(f[2]))
        self.assertEqual(codec.toggle_of(out).tolist(), [2, 2, 0])


if __name__ == "__main__":
    unittest.main()
```

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_codec tests.test_codec_skins -v`. Expected: PASS: the codec's existing tests and these 2.

**Contract, `docs/engineering/relight-package.md`, section "Record (12 bytes per splat)".** Replace the flags row's text `Flags: bits 0–2 class (0 interior, 1 embrasure, 2 hidden, 3 chandelier bulb, 4 dome lamp, 5 cove strip, 6 chandelier fixture); bit 3 isotropic receiver; bit 4 reachable by the sun (R1a \`windows.sun_reach\`: some real sun can light the splat through some window; analytic and conservative, occupancy ignored); bit 5 chandelier group centre (else end)` with:

`Flags: bits 0–2 class (0 interior, 1 embrasure, 2 hidden, 3 chandelier bulb, 4 dome lamp, 5 cove strip, 6 chandelier fixture, 7 covered by a skin); bit 3 isotropic receiver; bit 4 reachable by the sun (R1a \`windows.sun_reach\`: some real sun can light the splat through some window; analytic and conservative, occupancy ignored); for classes 3 and 6, bit 5 chandelier group centre (else end); for class 7, bits 5–7 its wall group (0 door wall, 1 window wall, 2 end_xmin, 3 end_xmax, 4 ceiling; 7 reserved); for every other class, bits 6–7 its toggle (0 none, 1 loose clutter, 2 AV cabinet). A class-7 flags byte is never 0xff.`

**R1b, Task 1 (`relight-codec.ts`).** Directly after `export const FLAG_CH_CENTRE = 1 << 5;` add:

```ts

/** Skins (R1c, amendment A1): a covered splat is class 7, its wall group in bits 5–7; any other class may carry a toggle in bits 6–7. */
export const CLASS_SKIN = 7;
export const SKIN_GROUP_SHIFT = 5;
export const TOGGLE_SHIFT = 6;
export const TOGGLE_CLUTTER = 1;
export const TOGGLE_CABINET = 2;

/** A class-7 record's wall group (0–6), or −1 for any other class. */
export function skinGroupOf(flags: number): number {
  return (flags & CLASS_MASK) === CLASS_SKIN ? (flags >> SKIN_GROUP_SHIFT) & 0b111 : -1;
}

/** A record's toggle (0 none, 1 clutter, 2 cabinet); class 7 carries none. */
export function toggleOf(flags: number): number {
  return (flags & CLASS_MASK) === CLASS_SKIN ? 0 : (flags >> TOGGLE_SHIFT) & 0b11;
}
```

Add `packages/web/src/lib/relight/__tests__/relight-codec-skins.test.ts` to Task 1's Files and run it with Task 1's tests:

```ts
import { describe, expect, it } from "vitest";
import { CLASS_CH_EMITTER, CLASS_SKIN, FLAG_CH_CENTRE, FLAG_ISO, FLAG_SUN, skinGroupOf, toggleOf } from "../relight-codec.js";

describe("record classes for the skins (T-639 R1c, amendment A1)", () => {
  it("reads a covered splat's wall group and an object's toggle, as R1a's codec writes them", () => {
    expect(skinGroupOf(CLASS_SKIN | FLAG_ISO | FLAG_SUN | (6 << 5))).toBe(6);
    expect(skinGroupOf(CLASS_CH_EMITTER | FLAG_CH_CENTRE)).toBe(-1);
    expect(toggleOf(2 << 6)).toBe(2);
    expect(toggleOf(CLASS_CH_EMITTER | FLAG_CH_CENTRE | (1 << 6))).toBe(1);
    expect(toggleOf(CLASS_SKIN | (3 << 5))).toBe(0);
  });
});
```

Run: `pnpm --filter @omnitwin/web exec vitest run src/lib/relight/__tests__/relight-codec-skins.test.ts`. Expected: PASS, 1 test.

---

## A2. Visibility in the normative multiplier

**R1a, section "The multiplier (normative)".** Replace the bullet `- Hidden (class 2: outside the hall, the environment shell, pane haze): alpha 0.` with:

```markdown
- Hidden (class 2: outside the hall, the environment shell, pane haze): alpha 0.
- Covered by a skin (class 7; amended for R1c): lit exactly as class 0 (`M = clamp(E / max(Ecap, 1e-4), 1/16, 8)`); alpha 0 while its wall group (bits 5–7) is drawn as skins (bit `group` of the visibility's `skin_groups`), else 1.
- Toggled (any class but 7 with bits 6–7 = t > 0; amended for R1c): alpha 0 while the toggle is hidden (bit `t − 1` of the visibility's `hidden_toggles`); otherwise its class's rule. The visibility defaults to nothing drawn and nothing hidden, so a package without skins or toggles is relit exactly as before.
```

**R1a, Task 5, Step 3 (`reference.py`).** Directly before `def smoothstep(a, b, x):` add:

```python
@dataclass(frozen=True)
class Visibility:
    """What the browser hides (R1c, amendment A2): wall groups drawn as skins (bit g) and hidden toggles (bit t - 1)."""
    skin_groups: int = 0
    hidden_toggles: int = 0


NO_VISIBILITY = Visibility()


```

Replace `def multiplier(direct, normals, flags, pos, colour_lin, model: Model, setting: Setting):` with `def multiplier(direct, normals, flags, pos, colour_lin, model: Model, setting: Setting, visibility: Visibility = NO_VISIBILITY):`. Then replace:

```python
    alpha = np.where(cls == codec.CLASS_HIDDEN, 0.0, 1.0)
```

with:

```python
    group = (flags >> codec.SKIN_GROUP_SHIFT).astype(np.int64)
    toggle = (flags >> codec.TOGGLE_SHIFT).astype(np.int64)
    covered = (cls == codec.CLASS_SKIN) & (((visibility.skin_groups >> group) & 1) == 1)
    toggled = (cls != codec.CLASS_SKIN) & (toggle > 0) & (((visibility.hidden_toggles >> np.maximum(toggle - 1, 0)) & 1) == 1)
    alpha = np.where((cls == codec.CLASS_HIDDEN) | covered | toggled, 0.0, 1.0)
```

If the controller's bounce revision (R1a Task 4 as committed, applied to Task 5 per R1d's A5 and A9) has rewritten `multiplier`, apply the same replacement to the line that sets `alpha` and the same signature change. Class 7 needs nothing else: it is neither the embrasure class nor a lamp class, so it takes the interior rule.

Add to `test_reference.py`, in `class Rules`:

```python
    def test_a_covered_splat_is_lit_as_interior_and_hidden_while_its_group_draws(self):
        d, n, f, p, c = splats(2)
        f[1] = codec.cover_flags(np.array([codec.CLASS_INTERIOR], np.uint8), 3)[0]
        m = model(); s = reference.Setting.captured(m)
        M, a = reference.multiplier(d, n, f, p, c, m, s)
        np.testing.assert_allclose(M[1], M[0]); self.assertEqual(a.tolist(), [1.0, 1.0])
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(skin_groups=1 << 3))
        self.assertEqual(a.tolist(), [1.0, 0.0])
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(skin_groups=1 << 2))
        self.assertEqual(a.tolist(), [1.0, 1.0])

    def test_a_toggled_splat_is_hidden_with_its_toggle(self):
        d, n, f, p, c = splats(2)
        f[:] = codec.toggle_flags(np.zeros(2, np.uint8), np.array([0, 2]))
        m = model(); s = reference.Setting.captured(m)
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(hidden_toggles=0b10))
        self.assertEqual(a.tolist(), [1.0, 0.0])
        _M, a = reference.multiplier(d, n, f, p, c, m, s, reference.Visibility(hidden_toggles=0b01))
        self.assertEqual(a.tolist(), [1.0, 1.0])
```

Task 5 Step 4's expected count rises by 2.

---

## A3. Covers and toggles in the records

**R1a, Task 5, Step 5 (`records.py`).** Directly after the function `transfer` add:

```python


# Covers and toggles (R1c, amendment A3). tools/skins (R1c Task 5) writes, in its geometry folder, covers.npz (each skin's
# frame and its relief envelope on 5 cm cells: wmin, wmax along the normal, NaN where it covers nothing) and toggles.json
# (axis-aligned E57 boxes: the toggleable objects, and the objects that must stay splats).
COVER_BELOW = 0.10      # a splat up to 10 cm behind the envelope's floor (wmin) is covered,
COVER_ABOVE = 0.03      # and up to 3 cm in front of its top (wmax),
COVER_SIGMA = 0.05      # plus twice its own largest scale, at most 5 cm.


def cover_test(pos, sigma_max, covers):
    """Each splat's wall group if a skin's envelope holds it (the cell under its centre, its depth within
    [wmin - 0.10, wmax + 0.03 + min(2 sigma_max, 0.05)]), else -1. covers: covers.npz as a dict."""
    P = np.asarray(pos, np.float64)
    smax = np.asarray(sigma_max, np.float64)
    out = np.full(len(P), -1, np.int64)
    cell = float(covers["cell"])
    wmin_all, wmax_all = np.asarray(covers["wmin"], np.float64), np.asarray(covers["wmax"], np.float64)
    for s in range(len(covers["ids"])):
        fr = np.asarray(covers["frames"][s], np.float64)
        o, u, v, n = fr[0:3], fr[3:6], fr[6:9], fr[9:12]
        rows, cols = (int(x) for x in covers["shapes"][s])
        off = int(covers["offsets"][s])
        D = P - o
        a, b, w = D @ u, D @ v, D @ n
        c = np.floor(a / cell).astype(np.int64)
        r = np.floor(b / cell).astype(np.int64)
        inside = (c >= 0) & (c < cols) & (r >= 0) & (r < rows) & (out < 0)
        if not inside.any():
            continue
        idx = off + r[inside] * cols + c[inside]
        lo = wmin_all[idx] - COVER_BELOW
        hi = wmax_all[idx] + COVER_ABOVE + np.minimum(2 * smax[inside], COVER_SIGMA)
        ok = np.isfinite(lo) & np.isfinite(hi) & (w[inside] >= lo) & (w[inside] <= hi)
        out[np.flatnonzero(inside)[ok]] = int(covers["groups"][s])
    return out


def in_boxes(pos, boxes):
    """Index of the first axis-aligned box (lo, hi) holding each splat, else -1."""
    P = np.asarray(pos, np.float64)
    out = np.full(len(P), -1, np.int64)
    for k, (lo, hi) in enumerate(boxes):
        hit = np.all((P > np.asarray(lo)) & (P < np.asarray(hi)), 1) & (out < 0)
        out[hit] = k
    return out


def apply_covers(flags, pos, sigma_max, covers, keep_boxes):
    """Class 7 for every interior splat a skin's envelope holds, unless a keep or toggle box holds it (the object stays a splat)."""
    group = cover_test(pos, sigma_max, covers)
    target = (group >= 0) & (in_boxes(pos, keep_boxes) < 0)
    out = np.asarray(flags, np.uint8).copy()
    out[target] = codec.cover_flags(out[target], group[target])
    return out


def apply_toggles(flags, pos, toggle_boxes):
    """toggle_boxes: [(lo, hi, toggle)]: the toggle of the first box holding each splat (class 7 excepted)."""
    k = in_boxes(pos, [(lo, hi) for lo, hi, _t in toggle_boxes])
    out = np.asarray(flags, np.uint8).copy()
    hit = k >= 0
    if hit.any():
        toggles = np.array([t for _lo, _hi, t in toggle_boxes], np.int64)
        out[hit] = codec.toggle_flags(out[hit], toggles[k[hit]])
    return out


def load_skin_inputs(geometry_dir):
    """tools/skins' geometry (R1c Task 5): covers.npz, and toggles.json's toggle boxes and keep boxes."""
    import json, os
    with np.load(os.path.join(geometry_dir, "covers.npz")) as z:
        covers = {k: z[k] for k in z.files}
    with open(os.path.join(geometry_dir, "toggles.json"), encoding="utf-8") as f:
        t = json.load(f)
    toggles = [(np.asarray(b["lo"], np.float64), np.asarray(b["hi"], np.float64), int(b["bit"])) for b in t["toggles"]]
    keep = [(np.asarray(b["lo"], np.float64), np.asarray(b["hi"], np.float64)) for b in t["keep"]] + [(lo, hi) for lo, hi, _t in toggles]
    return covers, toggles, keep
```

In `test_records.py`, add before `if __name__ == "__main__":`:

```python
class Covers(unittest.TestCase):
    COVERS = {"ids": np.array(["door-w2"]), "groups": np.array([0], np.int8),
              "frames": np.array([[0.0, 0, 0, 1, 0, 0, 0, 0, -1, 0, -1, 0]]),     # origin, u +x, v -z, normal -y
              "cell": np.float64(0.05), "shapes": np.array([[2, 2]]), "offsets": np.array([0]),
              "wmin": np.array([0.0, 0.0, 0.0, np.nan], np.float32), "wmax": np.array([0.01, 0.01, 0.01, np.nan], np.float32)}

    def test_splats_in_the_envelope_are_covered_in_their_group(self):
        P = np.array([[0.02, -0.02, -0.02], [0.02, -0.20, -0.02], [0.07, -0.02, -0.07], [0.02, 0.05, -0.02]])
        self.assertEqual(records.cover_test(P, np.full(4, 0.002), self.COVERS).tolist(), [0, -1, -1, 0])

    def test_boxes_keep_objects_as_splats_and_toggle_them(self):
        P = np.array([[0.02, -0.02, -0.02], [0.03, -0.02, -0.03], [5.0, 5.0, 5.0]])
        box = (np.array([0.025, -0.1, -0.05]), np.array([0.05, 0.0, 0.0]))
        covered = records.apply_covers(np.zeros(3, np.uint8), P, np.full(3, 0.002), self.COVERS, [box])
        self.assertEqual(codec.skin_group_of(covered).tolist(), [0, -1, -1])
        toggled = records.apply_toggles(covered, P, [(box[0], box[1], 1)])
        self.assertEqual(codec.toggle_of(toggled).tolist(), [0, 1, 0])
```

and change Step 5's "Expected: PASS, 4 tests." to "Expected: PASS, 6 tests."

**R1a, Task 5, Step 6 (the `records` command).** At the end of item 3 ("For each of the other 12 served tiles …"), add a new item:

```markdown
4a. (Amended for R1c.) With `--skins <tools/skins geometry folder>`: `covers, toggles, keep = records.load_skin_inputs(folder)`, then on every level, after its flags are computed, `flags = records.apply_toggles(records.apply_covers(flags, P_e57, sigma_max, covers, keep), P_e57, toggles)`, each splat at its own e57 position. `sigma_max` is the splat's largest scale: on the finest level the row maximum of `npy/splats_scl.npy` (float16 metres), on the others the row maximum of `decode_tile`'s `scales` (the codebook already exponentiated, `tools/xgrids-lcc2/scripts/sog-floor-census.py`). Print each level's covered splats per wall group and toggled splats per toggle. Without `--skins` nothing changes.
```

---

## A4. The skins' light (`skin-light`)

**R1a, code.** Create `tools/relight/relight/skinlight.py`:

```python
"""The skins' light (R1c, amendment A4): R1a's floor light model at every 5 cm light texel of every skin (the nine
sources' direct light, white and unit, the windows with the capture's sky weights, at the texel's centre 2 cm in front
of its bay plane with the height field's normal), packed as R1a records with the skins' own ranges; each skin's share of
sun-reachable texels on its 2 cm sun grid; and relight package v2's skins section built from them."""
from __future__ import annotations

import gzip, hashlib, json, os, posixpath

import numpy as np

from . import codec

VISIBILITY = {"toggles": {"clutter": 1, "cabinet": 2}, "defaultHidden": 1}   # the loose clutter hidden, the cabinet shown


def skin_light_grids(path):
    """tools/skins' light-grids.json (R1c Task 5), each skin with its light texels' normals loaded."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    root = os.path.dirname(path)
    out = []
    for e in data["skins"]:
        w, h = (int(v) for v in e["size"])
        normals = np.load(os.path.join(root, e["normals"])).astype(np.float64)
        if normals.shape != (h, w, 3):
            raise ValueError(f"{e['id']}: normals {normals.shape}, expected {(h, w, 3)}")
        sun = e.get("sun")
        out.append({"id": e["id"], "group": int(e["group"]), "lightTexel": float(e["lightTexel"]), "size": (w, h),
                    "texelToModel": np.asarray(e["texelToModel"], np.float64).reshape(4, 4), "normals": normals,
                    "sun": None if sun is None else {"size": tuple(int(v) for v in sun["size"]),
                                                    "texelToModel": np.asarray(sun["texelToModel"], np.float64).reshape(4, 4)}})
    return out


def grid_points(M, size):
    """Every texel's centre, M @ (column, row, 0, 1), row-major."""
    w, h = size
    rows, cols = np.meshgrid(np.arange(h, dtype=np.float64), np.arange(w, dtype=np.float64), indexing="ij")
    return (M[:3, 0] * cols[..., None] + M[:3, 1] * rows[..., None] + M[:3, 3]).reshape(-1, 3)


def pack_skin_records(D, normals, ranges):
    return codec.pack_records(D, normals, np.full(len(D), codec.CLASS_INTERIOR, np.uint8), ranges)


def skins_section(skin_light_dir, skin_package_dir, groups):
    """Relight package v2's `skins` section and its files ({relative path: gzip bytes}) from the skin-light output and the
    skin package (whose manifest it pins by SHA-256)."""
    with open(os.path.join(skin_light_dir, "index.json"), encoding="utf-8") as f:
        index = json.load(f)
    with open(os.path.join(skin_package_dir, "manifest.json"), "rb") as f:
        manifest_bytes = f.read()
    package = posixpath.join(*os.path.normpath(skin_package_dir).replace("\\", "/").split("/")[-2:])
    if not package.startswith("skins/"):
        raise ValueError(f"{skin_package_dir} is not a skins/<version> folder")
    entries, files = [], {}
    for s in index["skins"]:
        with open(os.path.join(skin_light_dir, f"{s['id']}.records"), "rb") as f:
            data = f.read()
        w, h = s["size"]
        if len(data) != w * h * codec.RECORD_BYTES:
            raise ValueError(f"{s['id']}: {len(data)} bytes for {w} x {h} light texels")
        gz = gzip.compress(data, compresslevel=9, mtime=0)
        rel = posixpath.join("skins", f"{s['id']}.light.gz")
        files[rel] = gz
        M = np.asarray(s["texelToModel"], np.float64).reshape(4, 4)
        n = np.cross(M[:3, 1], M[:3, 0])
        n = n / np.linalg.norm(n)
        entries.append({"id": s["id"], "group": int(s["group"]), "size": [int(w), int(h)], "texelToModel": [float(x) for x in M.ravel()],
                        "normal": [float(x) for x in n], "file": rel, "sha256": hashlib.sha256(gz).hexdigest(), "bytes": len(gz),
                        "sun": s["sun"]})
    section = {"package": package, "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
               "encoding": [[float(lo), float(hi)] for lo, hi in index["ranges"]], "groups": list(groups), "entries": entries}
    return section, files
```

(A light texel's normal in the section is the bay's: the light grid's column and row directions are `u` and `v` with `u × v = −n`, so `n = v × u`.)

In `tools/relight/relight/__main__.py`, in `main`, directly after `    ap.add_argument("--config", required=True)` add:

```python
    ap.add_argument("--skins", default=None)          # R1c: skin-light takes light-grids.json; records takes the geometry folder
    ap.add_argument("--skin-light", default=None)     # R1c: records' <work>/skin-light, for package v2's skins section
    ap.add_argument("--skin-package", default=None)   # R1c: the skin package folder package v2 names
    ap.add_argument("--out", default=None)            # R1c: the package's folder (default the config's out)
    ap.add_argument("--package", default=None)        # R1c: the package check reads (default the config's out)
```

and directly after `COMMANDS["floor"] = cmd_floor` add:

```python


def cmd_skin_light(cfg, args) -> int:
    """<work>/skin-light/<id>.records and index.json (R1c, amendment A4): every skin light texel's nine sources' direct
    light, cmd_floor's model at the skins' texel centres and normals (tools/skins' light-grids.json), as R1a records with
    the skins' own ranges; each skin's sun-reachable share on its 2 cm sun grid (windows.sun_reach), its sun grid named
    only when some texel is reachable. CPU only."""
    import importlib
    from . import codec, floorlight as FL, probes as PR, skinlight as SL
    from . import windows as W
    if args.skins is None:
        print("skin-light needs --skins <tools/skins work>/geometry/light-grids.json", flush=True)
        return 2
    common, lt, _radiosity, fit04 = _proof_modules()
    b3 = importlib.import_module("03_bases")
    started, work = time.time(), cfg.paths["work"]
    with np.load(os.path.join(work, "probes.npz")) as z:
        volume = {"cubes": z["win_cubes"], "origin": tuple(float(v) for v in z["origin"]),
                  "shape": tuple(int(v) for v in z["shape"]), "keep": z["keep"]}
    with np.load(os.path.join(work, "geom.npz")) as z:
        house = {"chandeliers": z["chandeliers"], "dome_c": z["dome_c"]}
    with np.load(os.path.join(work, "bases.npz")) as z:
        house["ring"] = z["ring"]
    box = (common.X0, common.X1, common.Y0, common.Y1, common.FLOOR_Z)
    grids = SL.skin_light_grids(args.skins)
    lights = []
    for g in grids:
        q, n = SL.grid_points(g["texelToModel"], g["size"]), g["normals"].reshape(-1, 3)
        direct = FL.patch_direct(lt, b3.trilinear_weights, volume, house, box, q, n)
        D = PR.patch_direct_by_source(direct, np.array(fit04.SKY_W))
        if not np.isfinite(D).all() or (D < 0).any():
            print(f"FAIL: {g['id']}: the direct light is not finite and non-negative", flush=True)
            return 1
        lights.append(D)
    ranges = [codec.source_range(np.concatenate([D[:, k] for D in lights])) for k in range(len(SOURCES))]
    vols = windows_volumes(cfg)
    out = os.path.join(work, "skin-light")
    os.makedirs(out, exist_ok=True)
    index = {"ranges": [list(r) for r in ranges], "skins": []}
    for g, D in zip(grids, lights):
        with open(os.path.join(out, f"{g['id']}.records"), "wb") as f:
            f.write(SL.pack_skin_records(D, g["normals"].reshape(-1, 3), ranges))
        reach, sun = 0.0, None
        if g["sun"] is not None:
            P = SL.grid_points(g["sun"]["texelToModel"], g["sun"]["size"])
            reach = float(np.mean(W.sun_reach(vols, P, cfg.room["site"]["latitude"])))
            if reach > 0:
                sun = {"size": list(g["sun"]["size"]), "texelToModel": [float(x) for x in g["sun"]["texelToModel"].ravel()]}
        index["skins"].append({"id": g["id"], "group": g["group"], "lightTexel": g["lightTexel"], "size": list(g["size"]),
                               "texelToModel": [float(x) for x in g["texelToModel"].ravel()], "reachShare": reach, "sun": sun})
        print(f"skin-light {g['id']}: {g['size'][0]} x {g['size'][1]} texels, sun reach {reach:.3f}", flush=True)
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1, allow_nan=False)
    with open(os.path.join(cfg.paths["evidence"], "skin-light.json"), "w", encoding="utf-8") as f:
        json.dump({"skins": len(grids), "texels": int(sum(len(D) for D in lights)), "ranges": index["ranges"],
                   "seconds": round(time.time() - started, 1)}, f, indent=1)
    return 0


COMMANDS["skin-light"] = cmd_skin_light
```

`time`, `json`, `os` and `np` are already imported at the top of `__main__.py`, and `SOURCES`, `windows_volumes` and `_proof_modules` are its own. The `skin-light` output is a data product. R1c Task 8 runs it twice by hand and compares the two folders, as the build PC's double-run rule requires for R1a's commands.

Create `tools/relight/tests/test_skinlight.py`:

```python
import gzip, hashlib, json, os, tempfile, unittest
import numpy as np
from relight import codec, skinlight as SL

M = [0.05, 0, 0, 0.025, 0, 0, -1, 0.98, 0, -0.05, 0, 1.975, 0, 0, 0, 1]   # u +x, v -z: the bay faces -y


def write_grids(root):
    os.makedirs(os.path.join(root, "door-w2"))
    np.save(os.path.join(root, "door-w2", "light-normals.npy"), np.tile([0.0, -1.0, 0.0], (2, 3, 1)))
    with open(os.path.join(root, "light-grids.json"), "w", encoding="utf-8") as f:
        json.dump({"skins": [{"id": "door-w2", "group": 0, "lightTexel": 0.05, "size": [3, 2], "texelToModel": M,
                              "normals": "door-w2/light-normals.npy", "sun": None}]}, f)
    return os.path.join(root, "light-grids.json")


class SkinLight(unittest.TestCase):
    def test_grids_load_with_their_normals_and_points(self):
        grids = SL.skin_light_grids(write_grids(tempfile.mkdtemp()))
        self.assertEqual((grids[0]["id"], grids[0]["size"]), ("door-w2", (3, 2)))
        P = SL.grid_points(grids[0]["texelToModel"], grids[0]["size"])
        np.testing.assert_allclose(P[4], [0.025 + 0.05, 0.98, 1.975 - 0.05], atol=1e-12)        # column 1, row 1

    def test_records_round_trip_and_the_section_pins_both_packages(self):
        root = tempfile.mkdtemp()
        light = os.path.join(root, "skin-light"); os.makedirs(light)
        D = np.zeros((6, 9)); D[:, 0] = 0.5; D[:, 5] = 0.25
        ranges = [codec.source_range(D[:, k]) for k in range(9)]
        with open(os.path.join(light, "door-w2.records"), "wb") as f:
            f.write(SL.pack_skin_records(D, np.tile([0.0, -1.0, 0.0], (6, 1)), ranges))
        with open(os.path.join(light, "index.json"), "w", encoding="utf-8") as f:
            json.dump({"ranges": [list(r) for r in ranges], "skins": [{"id": "door-w2", "group": 0, "lightTexel": 0.05, "size": [3, 2],
                                                                       "texelToModel": M, "reachShare": 0.0, "sun": None}]}, f)
        pkg = os.path.join(root, "grand-hall", "skins", "v1"); os.makedirs(pkg)
        with open(os.path.join(pkg, "manifest.json"), "wb") as f:
            f.write(b'{"schema": "venviewer.skins.v1"}')
        section, files = SL.skins_section(light, pkg, ["door", "window", "end_xmin", "end_xmax", "ceiling"])
        self.assertEqual(section["package"], "skins/v1")
        self.assertEqual(section["manifestSha256"], hashlib.sha256(b'{"schema": "venviewer.skins.v1"}').hexdigest())
        entry = section["entries"][0]
        np.testing.assert_allclose(entry["normal"], [0.0, -1.0, 0.0], atol=1e-12)
        direct, _n, flags = codec.unpack_records(gzip.decompress(files[entry["file"]]), ranges)
        np.testing.assert_allclose(direct[:, 0], 0.5, rtol=0.04)
        self.assertEqual(flags.tolist(), [codec.CLASS_INTERIOR] * 6)


if __name__ == "__main__":
    unittest.main()
```

The matrix has u = +x and v = −z, so `n = v × u = (0, 0, −1) × (1, 0, 0) = (0, −1, 0)`.

Run: `cd D:/claude/real-hall/repo/tools/relight && C:/Python313/python.exe -m unittest tests.test_skinlight -v`. Expected: PASS, 2 tests.

Commit A1's Python part and A4 together:

```bash
cd D:/claude/real-hall/repo
git add tools/relight/relight/codec.py tools/relight/relight/skinlight.py tools/relight/relight/__main__.py tools/relight/tests/test_codec_skins.py tools/relight/tests/test_skinlight.py
git diff --cached --stat
git commit -m "feat(relight): record classes for skins and toggles, and the skins' light (T-639 R1c amendments A1, A4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Overlap:** if R1d's amendments add arguments or commands to `__main__.py` (the Moon's), keep both. R1c's arguments sit directly after `--config`, and its command directly after `COMMANDS["floor"]`.

---

## A5. Relight package v2

Relight package v2 is v1 plus four things: the covers and toggles in its records (A3), its `skins` section, its `visibility` section, and the files `skins/<id>.light.gz`. Its schema stays `venviewer.relight.v1`, because the sections are optional for a reader. Only the folder is `relight/v2`.

**R1a, Task 5, Step 6.** In the paragraph describing `package.py`, replace `` `package.py` writes every file of `docs/engineering/relight-package.md` into `cfg.paths["out"]`: `` with `` `package.py` writes every file of `docs/engineering/relight-package.md` into the package folder (`args.out` when given, amended for R1c; otherwise `cfg.paths["out"]`): ``. At the end of that paragraph add:

```markdown
(Amended for R1c.) With `--skin-light <dir>` and `--skin-package <dir>`, `package.write` also takes `section, files = skinlight.skins_section(skin_light_dir, skin_package_dir, groups)`, where `groups` is `["door", "window", "end_xmin", "end_xmax", "ceiling"]`. It writes each of `files` (`skins/<id>.light.gz`, compressed with `mtime = 0`) with a SHA-256 and size in `files`, and adds the manifest fields `skins: section` and `visibility: skinlight.VISIBILITY`. Without them, neither field is written. The manifest's `evidence.build` records `{ skins, skinLight, skinPackage }` (the three arguments, or null), so check 4 can rebuild exactly.
```

In item 4 of the `records` command, replace `4. Writes the package with \`package.write\`,` with `4. Writes the package with \`package.write\` (into \`args.out\` when given; amended for R1c),`.

**R1a, Task 5, Step 7 (the `check` command).** Replace `Register a \`check\` command that reads the package back from disk (never in-memory arrays)` with `Register a \`check\` command that reads the package back from disk (never in-memory arrays; \`--package <dir>\` names the package, default \`cfg.paths["out"]\`, amended for R1c)`. In check 4 (determinism), append: "With `--package`, the second write uses the arguments recorded in the package's `evidence.build`."

**Contract, `docs/engineering/relight-package.md`.** In section "Files", add the row `| \`skins/<id>.light.gz\` | Package v2 (R1c): one skin's light texels as 12-byte records (R1a's layout, row-major, the skins' own ranges \`skins.encoding\`), gzip |`. In section "Manifest (fields)", add:

```markdown
- `skins` (package v2, optional; R1c): `{ package, manifestSha256, encoding, groups, entries }`.
  - `package`: the skin package's folder beside the tiles (`"skins/v1"`); `manifestSha256` pins its manifest.
  - `encoding`: the skins' log ranges per source.
  - `groups`: `["door", "window", "end_xmin", "end_xmax", "ceiling"]`, the record wall groups 0–4.
  - `entries[]`: `{ id, group, size: [w, h], texelToModel (16, row-major: (column, row, 0, 1) ↦ the light texel's centre,
    2 cm in front of its bay), normal, file, sha256, bytes, sun: { size, texelToModel } | null }`. `sun` is the skin's 2 cm
    sun grid, 5 mm in front of its bay, named only when some of its texels can be reached by the sun or the moon
    (`windows.sun_reach`).
- `visibility` (package v2, optional; R1c): `{ toggles: { clutter: 1, cabinet: 2 }, defaultHidden }`, the toggles'
  record values and those hidden by default as bits `1 << (toggle − 1)` (1: the loose clutter hidden, the cabinet shown).
```

---

## A6. The kernel's visibility (R1b)

**R1b, Task 4 (`relight-kernel.ts`).**

1. In the import from `./relight-codec.js`, add `CLASS_SKIN, SKIN_GROUP_SHIFT, TOGGLE_SHIFT`.
2. Directly before `/** One splat's multiplier and alpha (the R1a plan's rules, in order: interior ratio, embrasure, clamp, lamps, hidden). */` add:

```ts
/** What the browser hides (R1c, amendment A6): wall groups drawn as skins (bit g) and hidden toggles (bit t − 1). */
export interface RelightVisibility {
  readonly skinGroups: number;
  readonly hiddenToggles: number;
}

export const NO_VISIBILITY: RelightVisibility = { skinGroups: 0, hiddenToggles: 0 };

```

3. Replace `export function relightSplat(model: RelightKernelModel, frame: KernelFrame, record: Uint8Array, position: Vec3, colour: Rgb): SplatMultiplier {` with `export function relightSplat(model: RelightKernelModel, frame: KernelFrame, record: Uint8Array, position: Vec3, colour: Rgb, visibility: RelightVisibility = NO_VISIBILITY): SplatMultiplier {`.
4. Replace `  return { m: [at(m, 0), at(m, 1), at(m, 2)], alpha: cls === CLASS_HIDDEN ? 0 : 1 };` with:

```ts
  // R1c (amendment A6): a covered splat (class 7, lit as class 0) while its wall group draws as skins; a toggled one while its toggle is hidden.
  const group = (flags >> SKIN_GROUP_SHIFT) & 0b111, toggle = (flags >> TOGGLE_SHIFT) & 0b11;
  const covered = cls === CLASS_SKIN && ((visibility.skinGroups >> group) & 1) === 1;
  const toggled = cls !== CLASS_SKIN && toggle > 0 && ((visibility.hiddenToggles >> (toggle - 1)) & 1) === 1;
  return { m: [at(m, 0), at(m, 1), at(m, 2)], alpha: cls === CLASS_HIDDEN || covered || toggled ? 0 : 1 };
```

5. In Task 4's Produces line, replace `` `relightSplat(model: RelightKernelModel, frame: KernelFrame, record: Uint8Array, position: Vec3, colour: Rgb): SplatMultiplier` `` with `` `interface RelightVisibility { skinGroups; hiddenToggles }`, `NO_VISIBILITY`; `relightSplat(model, frame, record, position, colour, visibility = NO_VISIBILITY): SplatMultiplier`; `bounceAt(model, frame, position, normal, iso): { capture: Rgb; scenario: Rgb }` (A8) ``.

Add to Task 4's `relight-kernel.test.ts` (its helpers `record(flags)`, `CENTRE`, `GREY` and `syntheticModel()`), in the `describe` holding the test that expects `record(CLASS_HIDDEN)` to give alpha 0:

```ts
  it("lights a covered splat as interior and hides it, or a toggled one, only as the visibility says (R1c, A6)", () => {
    const model = syntheticModel();
    const frame = prepareKernelFrame(model, capturedSetting(model));
    const coveredRecord = record(CLASS_SKIN | (3 << SKIN_GROUP_SHIFT));
    expect(relightSplat(model, frame, coveredRecord, CENTRE, GREY)).toEqual(relightSplat(model, frame, record(0), CENTRE, GREY));
    expect(relightSplat(model, frame, coveredRecord, CENTRE, GREY, { skinGroups: 1 << 3, hiddenToggles: 0 }).alpha).toBe(0);
    expect(relightSplat(model, frame, coveredRecord, CENTRE, GREY, { skinGroups: 1 << 2, hiddenToggles: 0 }).alpha).toBe(1);
    expect(relightSplat(model, frame, record(2 << TOGGLE_SHIFT), CENTRE, GREY, { skinGroups: 0, hiddenToggles: 0b10 }).alpha).toBe(0);
    expect(relightSplat(model, frame, record(2 << TOGGLE_SHIFT), CENTRE, GREY, { skinGroups: 0, hiddenToggles: 0b01 }).alpha).toBe(1);
  });
```

and add `CLASS_SKIN, SKIN_GROUP_SHIFT, TOGGLE_SHIFT` to that file's import from `../relight-codec.js`. Task 4's expected kernel test count rises by 1.

---

## A7. The manifest's sections (R1b)

**R1b, Task 2 (`relight-manifest.ts`).** Directly before `export const RelightManifestSchema = z.object({` add:

```ts
/** Relight package v2's skins (R1c, amendment A7): the skin package it names and each skin's light grid. */
const skinGridSize = z.tuple([z.number().int().min(2).max(16384), z.number().int().min(2).max(16384)]);
export const SkinsSectionSchema = z.object({
  package: packagePath,
  manifestSha256: sha256,
  encoding: z.array(logRange).length(SOURCE_COUNT),
  groups: z.tuple([z.literal("door"), z.literal("window"), z.literal("end_xmin"), z.literal("end_xmax"), z.literal("ceiling")]),
  entries: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_]+(-[a-z0-9_]+)*$/u),
    group: z.number().int().min(0).max(4),
    size: skinGridSize,
    texelToModel: matrix4,
    normal: vec3,
    file: packagePath,
    sha256,
    bytes: z.number().int().positive(),
    sun: z.object({ size: skinGridSize, texelToModel: matrix4 }).nullable(),
  })).min(1).max(512),
});
export type RelightSkinsSection = z.infer<typeof SkinsSectionSchema>;
export type RelightSkinLight = RelightSkinsSection["entries"][number];

/** The toggles' record values and those hidden by default, as bits 1 << (toggle − 1) (R1c, amendment A7). */
export const VisibilitySectionSchema = z.object({
  toggles: z.object({ clutter: z.literal(1), cabinet: z.literal(2) }),
  defaultHidden: z.number().int().min(0).max(3),
});
export type RelightVisibilitySection = z.infer<typeof VisibilitySectionSchema>;

```

Replace:

```ts
  files: z.record(packagePath, z.object({ sha256, bytes: z.number().int().nonnegative() })),
}).superRefine((manifest, context) => {
  const issue = (path: (string | number)[], message: string): void => {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
```

with:

```ts
  files: z.record(packagePath, z.object({ sha256, bytes: z.number().int().nonnegative() })),
  skins: SkinsSectionSchema.optional(),
  visibility: VisibilitySectionSchema.optional(),
}).superRefine((manifest, context) => {
  const issue = (path: (string | number)[], message: string): void => {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
  const skinIds = new Set<string>();
  manifest.skins?.entries.forEach((entry, index) => {
    const file = manifest.files[entry.file];
    if (file === undefined || file.sha256 !== entry.sha256 || file.bytes !== entry.bytes) issue(["skins", "entries", index], `The skin light ${entry.file} does not match its checksum entry.`);
    if (skinIds.has(entry.id)) issue(["skins", "entries", index], `The skin ${entry.id} appears twice.`);
    skinIds.add(entry.id);
  });
```

In Task 2's Produces line, add: `SkinsSectionSchema`, `type RelightSkinsSection`, `type RelightSkinLight`, `VisibilitySectionSchema`, `type RelightVisibilitySection`; `RelightManifestSchema` accepts the optional `skins` and `visibility` (relight package v2, R1c).

Add to `relight-manifest.test.ts`:

```ts
  it("accepts relight package v2's sections and refuses a skin light without its checksum (R1c, A7)", () => {
    const entry = { id: "door-w2", group: 0, size: [8, 6], texelToModel: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)), normal: [0, -1, 0],
      file: "skins/door-w2.light.gz", sha256: "c".repeat(64), bytes: 10, sun: null };
    const skins = { package: "skins/v1", manifestSha256: "d".repeat(64), encoding: Array.from({ length: 9 }, () => [-12, 4]),
      groups: ["door", "window", "end_xmin", "end_xmax", "ceiling"], entries: [entry] };
    const files = { ...manifest.files, "skins/door-w2.light.gz": { sha256: "c".repeat(64), bytes: 10 } };
    const visibility = { toggles: { clutter: 1, cabinet: 2 }, defaultHidden: 1 };
    const parsed = RelightManifestSchema.parse({ ...manifest, files, skins, visibility });
    expect(parsed.skins?.entries[0]?.id).toBe("door-w2");
    expect(RelightManifestSchema.safeParse({ ...manifest, skins, visibility }).success).toBe(false);
    expect(RelightManifestSchema.safeParse({ ...manifest, files, skins: { ...skins, groups: ["window", "door", "end_xmin", "end_xmax", "ceiling"] } }).success).toBe(false);
  });
```

and change Step 6's expected count for `relight-manifest.test.ts` from 17 to 18 tests.

---

## A8. The shared bounce and extra passes (R1b)

Both the skins' light pass and the multiplier pass need the same bounce, and the skins need their passes in the frame's one compute call.

**R1b, Task 4 (`relight-kernel.ts`).** Directly after the `NO_VISIBILITY` constant (A6) add:

```ts
/**
 * The bounce light at a point (R1a's I terms, folded): the capture's and the setting's cubes, trilinear over valid
 * probes, evaluated at the normal. relightSplat's own bounce, shared with the skins' light (R1c, amendment A8).
 */
export function bounceAt(model: RelightKernelModel, frame: KernelFrame, position: Vec3, normal: Vec3, iso: boolean): { readonly capture: Rgb; readonly scenario: Rgb } {
  const { indices, weights } = trilinearCorners(model.probes, position);
  const captureCube = new Float64Array(PROBE_FOLDED), scenarioCube = new Float64Array(PROBE_FOLDED);
  indices.forEach((index, corner) => {
    const weight = weights[corner] ?? 0;
    if (weight === 0) return;
    const capture = frame.capCube(index), scenario = frame.scenarioCube(index);
    for (let value = 0; value < PROBE_FOLDED; value += 1) {
      captureCube[value] = at(captureCube, value) + weight * at(capture, value);
      scenarioCube[value] = at(scenarioCube, value) + weight * at(scenario, value);
    }
  });
  return { capture: cubeEval(captureCube, normal, iso), scenario: cubeEval(scenarioCube, normal, iso) };
}

```

and in `relightSplat` replace:

```ts
  const { indices, weights } = trilinearCorners(model.probes, position);
  const captureCube = new Float64Array(PROBE_FOLDED), scenarioCube = new Float64Array(PROBE_FOLDED);
  indices.forEach((index, corner) => {
    const weight = weights[corner] ?? 0;
    if (weight === 0) return;
    const capture = frame.capCube(index), scenario = frame.scenarioCube(index);
    for (let value = 0; value < PROBE_FOLDED; value += 1) {
      captureCube[value] = at(captureCube, value) + weight * at(capture, value);
      scenarioCube[value] = at(scenarioCube, value) + weight * at(scenario, value);
    }
  });
  const eCap = [...cubeEval(captureCube, normal, iso)];
  const e = [...cubeEval(scenarioCube, normal, iso)];
```

with:

```ts
  const bounce = bounceAt(model, frame, position, normal, iso);
  const eCap = [...bounce.capture];
  const e = [...bounce.scenario];
```

If the controller's bounce revision (R1a Task 4's sky-body basis, R1d A9) changed how `relightSplat` forms its bounce, `bounceAt` holds exactly that code instead. The skins must receive the same scenario bounce as the splats, both bodies' included.

**R1b, Task 10 (`relight-frame.ts`).**

1. In the `three/tsl` import add `clamp` and `min` if absent. **Overlap:** R1d A2 adds the same.
2. Add `PROBE_CAPTURE_STRIDE` to the import from `./relight-assets.js` if absent. **Overlap:** R1d A2.
3. Directly after `export type WindowVolumeRead = ReturnType<typeof windowVolumeRead>;` add:

```ts

/** The two folded probe volumes as one pass reads them (R1c, amendment A8): the capture's with its validity, the scenario's. */
export function probeReads(frame: RelightFrame) {
  return {
    capture: storage(frame.probeCapture, "float", frame.probeCount * PROBE_CAPTURE_STRIDE).toReadOnly(),
    scenario: storage(frame.probeScenario, "float", frame.probeCount * PROBE_FOLDED).toReadOnly(),
  };
}
export type ProbeReads = ReturnType<typeof probeReads>;

/**
 * bounceAt in TSL (R1c, amendment A8): trilinear over valid probes, each corner's two folded cubes evaluated at the
 * normal (the mean of the six faces for an isotropic receiver), the weights renormalised. The multiplier pass's own
 * code, shared with the skins' light pass.
 */
export function bounceNode(u: RelightUniforms, reads: ProbeReads, p: Node<"vec3">, normal: Node<"vec3">, iso: Node<"bool">): { capture: Node<"vec3">; scenario: Node<"vec3"> } {
  const faces = [max(normal.x, 0).pow2(), max(normal.x.negate(), 0).pow2(), max(normal.y, 0).pow2(), max(normal.y.negate(), 0).pow2(), max(normal.z, 0).pow2(), max(normal.z.negate(), 0).pow2()]
    .map((weight) => select(iso, float(1 / 6), weight));
  const q = clamp(p.sub(u.probeOrigin).div(u.probeSpacing), vec3(0), u.probeShape.sub(1 + 1e-6)).toVar();
  const cell = floor(q).toVar();
  const f = q.sub(cell).toVar();
  const bounceCapture = vec3(0).toVar(), bounceScenario = vec3(0).toVar(), weightSum = float(0).toVar();
  for (const dx of [0, 1]) {
    for (const dy of [0, 1]) {
      for (const dz of [0, 1]) {
        const cx = min(cell.x.add(dx), u.probeShape.x.sub(1)), cy = min(cell.y.add(dy), u.probeShape.y.sub(1)), cz = min(cell.z.add(dz), u.probeShape.z.sub(1));
        const index = uint(cx.mul(u.probeShape.y).add(cy).mul(u.probeShape.z).add(cz)).toVar();
        const captureBase = index.mul(PROBE_CAPTURE_STRIDE).toVar(), scenarioBase = index.mul(PROBE_FOLDED).toVar();
        const weight = (dx === 1 ? f.x : float(1).sub(f.x)).mul(dy === 1 ? f.y : float(1).sub(f.y)).mul(dz === 1 ? f.z : float(1).sub(f.z))
          .mul(reads.capture.element(captureBase.add(PROBE_FOLDED))).toVar();
        const evaluate = (read: ProbeReads["capture"], base: Node<"uint">, c: number): Node<"float"> => faces
          .map((face, faceIndex) => face.mul(read.element(base.add(c * 6 + faceIndex))))
          .reduce((sum, term) => sum.add(term));
        bounceCapture.addAssign(vec3(evaluate(reads.capture, captureBase, 0), evaluate(reads.capture, captureBase, 1), evaluate(reads.capture, captureBase, 2)).mul(weight));
        bounceScenario.addAssign(vec3(evaluate(reads.scenario, scenarioBase, 0), evaluate(reads.scenario, scenarioBase, 1), evaluate(reads.scenario, scenarioBase, 2)).mul(weight));
        weightSum.addAssign(weight);
      }
    }
  }
  const normaliser = select(weightSum.greaterThan(0), float(1).div(max(weightSum, 1e-12)), float(0));
  return { capture: bounceCapture.mul(normaliser), scenario: bounceScenario.mul(normaliser) };
}
```

4. In `class RelightFrame`, directly after `  private readonly listeners = new Set<() => void>();` add `  private readonly extraPasses: ComputeNode[] = [];`, and directly after the method `onApply` add:

```ts

  /** Passes run in prepare after the frame's own (R1c's skins, amendment A8); the returned function removes them. */
  addPasses(passes: readonly ComputeNode[]): () => void {
    this.extraPasses.push(...passes);
    this.dirty = true;
    return () => {
      for (const pass of passes) {
        const at = this.extraPasses.indexOf(pass);
        if (at >= 0) this.extraPasses.splice(at, 1);
      }
    };
  }
```

5. In `prepare`, replace `    void renderer.compute([this.foldPass, this.floorSunPass]);` with `    void renderer.compute([this.foldPass, this.floorSunPass, ...this.extraPasses]);`. **Overlap:** R1d A2 replaces the same call with one that already ends in `...this.extraPasses`; keep R1d's.
6. In Task 10's Produces line, add `probeReads(frame): ProbeReads`, `bounceNode(u, reads, p, normal, iso): { capture; scenario }`, and `addPasses(passes: readonly ComputeNode[]): () => void` (A8).

**R1b, Task 11 (`relight-draw.ts`).**

1. Add `bounceNode` and `probeReads` to the import from `./relight-frame.js`.
2. Replace:

```ts
  const captureRead = storage(frame.probeCapture, "float", frame.probeCount * PROBE_CAPTURE_STRIDE).toReadOnly();
  const scenarioRead = storage(frame.probeScenario, "float", frame.probeCount * PROBE_FOLDED).toReadOnly();
```

with `  const reads = probeReads(frame);`.

3. Replace the whole block from `    // Trilinear over valid probes; each corner's two folded cubes evaluated at the normal.` through `    const eCap = bounceCapture.mul(normaliser).toVar(), e = bounceScenario.mul(normaliser).toVar();` with:

```ts
    // Trilinear over valid probes; each corner's two folded cubes evaluated at the normal (A8's shared bounceNode).
    const bounce = bounceNode(u, reads, p, normal, iso);
    const eCap = bounce.capture.toVar(), e = bounce.scenario.toVar();
```

The binding count is unchanged: the same two probe buffers. Drop `PROBE_CAPTURE_STRIDE` from that file's imports if nothing else uses it.

Add to `relight-frame.test.ts` (its `data` and `application(frame, preset)` helpers), with `import { Fn } from "three/tsl";` added to its imports:

```ts
  it("runs added passes in prepare after its own, until they are removed (R1c, A8)", () => {
    const frame = new RelightFrame(data);
    const extra = Fn(() => {})().compute(1).setName("Extra");
    const remove = frame.addPasses([extra]);
    const renderer = new WebGPURenderer({ forceWebGL: true });
    const compute = vi.spyOn(renderer, "compute").mockImplementation(() => undefined);
    frame.prepare(renderer);
    const first = compute.mock.calls[0]?.[0];
    expect(Array.isArray(first) ? first.at(-1)?.name : null).toBe("Extra");
    remove();
    frame.apply(application(frame, "night"));
    frame.prepare(renderer);
    const second = compute.mock.calls[1]?.[0];
    expect(Array.isArray(second) ? second.map((pass) => pass.name) : []).not.toContain("Extra");
  });
```

---

## A9. The frame's visibility and the multiplier's alpha (R1b)

**R1b, Task 10 (`relight-frame.ts`).**

1. Add `NO_VISIBILITY` and `type RelightVisibility` to the import from `./relight-kernel.js`.
2. In `createRelightUniforms`, directly after `    emitterBoost: uniform(1),` add:

```ts
    /** R1c (amendment A9): the wall groups drawn as skins (bit g) and the hidden toggles (bit t − 1). */
    skinGroups: uniform(0, "uint"),
    hiddenToggles: uniform(0, "uint"),
```

3. In `class RelightFrame`, directly after `  lastApplyMs: number | null = null;` add `  visibility: RelightVisibility = NO_VISIBILITY;`. Directly before the method `onApply` add:

```ts
  /** The wall groups drawn as skins and the hidden toggles (R1c, amendment A9); every draw's pass reruns through onApply's listeners. */
  setVisibility(visibility: RelightVisibility): void {
    if (visibility.skinGroups === this.visibility.skinGroups && visibility.hiddenToggles === this.visibility.hiddenToggles) return;
    this.visibility = visibility;
    this.uniforms.skinGroups.value = visibility.skinGroups;
    this.uniforms.hiddenToggles.value = visibility.hiddenToggles;
    for (const listener of this.listeners) listener();
  }

```

4. In Task 10's Produces line, add: `visibility: RelightVisibility`, `setVisibility(visibility: RelightVisibility): void`, and the uniforms `skinGroups` and `hiddenToggles` (uint) (A9).

If TypeScript rejects `uniform(0, "uint")`'s inferred type where `.value` is assigned a number, change the annotation only (R1b Global Constraints).

**R1b, Task 11 (`relight-draw.ts`).** Replace:

```ts
    const alpha = select(cls.equal(2), uint(0), uint(255));
```

with:

```ts
    // R1c (amendment A9): a covered splat (class 7) while its wall group draws as skins; a toggled one while its toggle is hidden.
    const group = flags.shiftRight(5).bitAnd(7), toggle = flags.shiftRight(6).bitAnd(3);
    const covered = cls.equal(7).and(u.skinGroups.shiftRight(group).bitAnd(1).equal(1));
    const toggled = cls.notEqual(7).and(toggle.greaterThan(0)).and(u.hiddenToggles.shiftRight(max(toggle, uint(1)).sub(1)).bitAnd(1).equal(1));
    const alpha = select(cls.equal(2).or(covered).or(toggled), uint(0), uint(255));
```

Class 7 needs nothing else in the pass: it is neither the embrasure branch (`cls.equal(1)`) nor the lamp branch (`3 ≤ cls ≤ 6`), so it takes the interior ratio. Bit 5 is read as the chandelier centre only inside the lamp branch.

Add to `relight-frame.test.ts`:

```ts
  it("sets the visibility's uniforms and reruns the draws' passes when it changes (R1c, A9)", () => {
    const frame = new RelightFrame(data);
    const listener = vi.fn();
    frame.onApply(listener);
    frame.setVisibility({ skinGroups: 0b10001, hiddenToggles: 0b01 });
    expect([frame.uniforms.skinGroups.value, frame.uniforms.hiddenToggles.value]).toEqual([0b10001, 0b01]);
    expect(listener).toHaveBeenCalledTimes(1);
    frame.setVisibility({ skinGroups: 0b10001, hiddenToggles: 0b01 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
```

---

## A10. The debug sample and the one preview (R1b)

**R1b, Task 17 (`relight-debug.ts`).** Replace `        const { m, alpha } = relightSplat(frame.model, kernel, record, position, colour);` with `        const { m, alpha } = relightSplat(frame.model, kernel, record, position, colour, frame.visibility);`. The GPU's alpha follows the frame's visibility, so the check compares like with like (R1c Task 23 samples with skins drawn).

**R1b, Task 19.** R1b ships to no preview; the one preview is R1d's Task 24 (R1 polished §5). **Overlap:** R1d's A10 makes the same change; keep one copy.

---

## What R1c's Task 0 checks

`grep` finds each of these after the amendments are applied and R1a and R1b are executed:

| Name | File | Amendment |
|---|---|---|
| `CLASS_SKIN = 7` | `tools/relight/relight/codec.py` | A1 |
| `def cover_flags` | `tools/relight/relight/codec.py` | A1 |
| `def toggle_flags` | `tools/relight/relight/codec.py` | A1 |
| `class Visibility` | `tools/relight/relight/reference.py` | A2 |
| `def apply_covers` | `tools/relight/relight/records.py` | A3 |
| `def apply_toggles` | `tools/relight/relight/records.py` | A3 |
| `COMMANDS["skin-light"]` | `tools/relight/relight/__main__.py` | A4 |
| `def skin_light_grids` | `tools/relight/relight/skinlight.py` | A4 |
| `export const CLASS_SKIN = 7` | `packages/web/src/lib/relight/relight-codec.ts` | A1 |
| `export function skinGroupOf` | `packages/web/src/lib/relight/relight-codec.ts` | A1 |
| `export interface RelightVisibility` | `packages/web/src/lib/relight/relight-kernel.ts` | A6 |
| `export function bounceAt` | `packages/web/src/lib/relight/relight-kernel.ts` | A8 |
| `export function bounceNode` | `packages/web/src/lib/relight/relight-frame.ts` | A8 |
| `export function probeReads` | `packages/web/src/lib/relight/relight-frame.ts` | A8 |
| `setVisibility(visibility: RelightVisibility): void` | `packages/web/src/lib/relight/relight-frame.ts` | A9 |
| `addPasses(passes: readonly ComputeNode[])` | `packages/web/src/lib/relight/relight-frame.ts` | A8 |
| `SkinsSectionSchema` | `packages/web/src/lib/relight/relight-manifest.ts` | A7 |

R1d's interface expectations of R1c (its section "The R1c interface R1d consumes") are met by R1c's tasks:

1. Records: A1.
2. Visibility: A6, A9, and R1c Task 20's `skinVisibility`.
3. Passes: A8, and Task 19's `SkinFrame.passes` and `setStride(stride, phase)`.
4. The skin material's hooks: Task 20's `litSkinMaterial(skin, frame, inputs, hooks?)`, with `SkinSurface` (including `bodyVisibility`), `SkinSheen`, `SkinLightHooks`, and Task 21's `SkinLightHooksContext`.
5. Names: `relight-skin`.
6. The Moon on the skins: Task 19's `SkinMoon` pass and Task 20's Moon term.
7. The store: Task 21's `hiddenToggles` and `setToggleHidden`, with the default from relight v2's `visibility.defaultHidden`.
8. Queries: `?skins=off`.
