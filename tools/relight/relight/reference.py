"""The normative relight multiplier (the plan's section "The multiplier"), in numpy.

The browser's GPU kernel (plan R1b) must match this within the codec's precision; the test vectors written by
`python -m relight check` hold both inputs and expected outputs. Each sky body's direct light (the Sun's and the Moon's)
is the window volume march of windows.sun_visibility (Task 3 as built). Their bounce is the factored sky-body basis of
sunbounce.py (Task 4 as built): per window the exact entering power P_w of the 56,448 patch rays times the smooth
response R_w of K basis volumes on the 1 m grid, mixed by the 4-degree coefficient table, resampled onto the 0.5 m
probes and evaluated there exactly as the nine sources' bounce is (the browser folds it into the scenario volume)."""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np

from . import codec, sunbounce
from .windows import sun_az_el, sun_visibility
from .windows import fresnel_at as window_fresnel_at

LUMW = np.array([0.2126, 0.7152, 0.0722])
WINDOWS = ("W1", "W2", "W3", "W4", "W5")
LAMP_GROUPS = ("cove", "ch_end", "ch_centre", "dome")


@dataclass(frozen=True, eq=False)
class SkyBounce:
    """The sky bodies' bounce basis as the package carries it (sunbounce.py; the contract's "The sky bodies' bounce")."""
    table: sunbounce.Table          # coeffs (rows, columns, windows, K) float32; az0, el0, step (degrees)
    basis: np.ndarray               # (K, M1, 3, 6) float16: the unit-field volumes on the basis grid
    origin: np.ndarray              # (3,) the basis grid's corner (model frame)
    spacing: float                  # 1.0 m
    shape: tuple                    # (22, 11, 7)
    valid: np.ndarray               # (M1,) bool
    patches: sunbounce.Patches      # the patch rays (16 n, 3), normals (n, 3) and areas (n,), float32
    floor_mean: np.ndarray          # (K, 3) float32: each volume's mean +z irradiance over the floor light maps


@dataclass(frozen=True, eq=False)
class Model:
    capture_w: np.ndarray        # (9,)
    capture_c: np.ndarray        # (9, 3)
    daylight_colour: np.ndarray  # (3,) the capture's daylight colour, c[W1]
    probes: np.ndarray           # (M, 9, 3, 6)
    probe_valid: np.ndarray      # (M,) bool
    probe_origin: np.ndarray     # (3,)
    probe_spacing: float
    probe_shape: tuple
    volumes: dict                # name -> windows.WindowVolume, in window order W1..W5; empty = no sky-body light
    fresnel: np.ndarray          # (101,)
    horizons: dict = field(default_factory=dict)   # name -> (360,) horizon elevation in degrees by compass azimuth
    sky: SkyBounce | None = None                  # the sky bodies' bounce; None in synthetic models without it


@dataclass(frozen=True)
class Setting:
    weights: np.ndarray          # (9, 3): each source's weight x colour
    sky_level: float
    sky_colour: np.ndarray       # (3,)
    lamp_levels: dict            # group -> level 0..1
    sun_dir: np.ndarray | None   # (3,) toward the sun, model frame
    sun_rgb: np.ndarray          # (3,)
    emitter_boost: float = 1.0   # 1 in every setting (R1d draws crisp bulbs instead of boosting the bulb splats)
    lamp_tints: dict = field(default_factory=lambda: {g: (1.0, 1.0, 1.0) for g in LAMP_GROUPS})   # group -> RGB tint
    moon_dir: np.ndarray | None = None   # (3,) toward the Moon, model frame (amendment A5)
    moon_rgb: np.ndarray = field(default_factory=lambda: np.zeros(3))

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


@dataclass(frozen=True)
class Visibility:
    """What the browser hides (R1c, amendment A2): wall groups drawn as skins (bit g) and hidden toggles (bit t - 1)."""
    skin_groups: int = 0
    hidden_toggles: int = 0


NO_VISIBILITY = Visibility()


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
    """The glass transmission for a sky body: windows.fresnel_at at its direction in float32, as sun_visibility takes it."""
    return window_fresnel_at(model.fresnel, np.asarray(s, np.float32))


def sky_bodies(setting: Setting) -> list:
    """The setting's sky bodies that have a direction, as (direction, RGB): the Sun, then the Moon."""
    return [(np.asarray(d, np.float64), np.asarray(rgb, np.float64))
            for d, rgb in ((setting.sun_dir, setting.sun_rgb), (setting.moon_dir, setting.moon_rgb)) if d is not None]


def window_powers(model: Model, s) -> np.ndarray:
    """P_w (windows,) for a sky body toward s: sunbounce.window_power at the float32 direction, each window gated by its
    horizon; zeros while the body is behind the wall."""
    names = [n for n in WINDOWS if n in model.volumes]
    return sunbounce.window_power([model.volumes[n] for n in names], [model.horizons[n] for n in names], model.fresnel,
                                  model.sky.patches, np.asarray(s, np.float32))


def body_coefficients(model: Model, s) -> np.ndarray:
    """(K,) float64: the basis volumes' weights for a white unit body toward s (sunbounce.coefficients with the exact
    powers, at the body's azimuth and elevation from its float32 direction)."""
    s32 = np.asarray(s, np.float32)
    first = next(iter(model.volumes.values()))
    az, el = sun_az_el(s32, first.x_bearing)
    return sunbounce.coefficients(model.sky.table, window_powers(model, s32), az, el)


def probe_points(model: Model) -> np.ndarray:
    """(M, 3): the probe grid's points, probe (ix ny + iy) nz + iz at origin + spacing (ix, iy, iz)."""
    nx, ny, nz = model.probe_shape
    ix, iy, iz = np.meshgrid(np.arange(nx), np.arange(ny), np.arange(nz), indexing="ij")
    return np.asarray(model.probe_origin, np.float64) + model.probe_spacing * np.stack([ix.ravel(), iy.ravel(), iz.ravel()], 1)


def to_probes(model: Model, values) -> np.ndarray:
    """(M, 3, 6): basis-grid values (M1, 3, 6) at the probes, trilinearly (sunbounce.trilinear_matrix: the cell clamped
    into the basis grid and the position into the cell, invalid corners dropped and the rest renormalised, none when
    their weights sum to at most 1e-6)."""
    sky = model.sky
    W = sunbounce.trilinear_matrix(sky.origin, sky.spacing, sky.shape, sky.valid, probe_points(model))
    v = np.asarray(values, np.float64)
    return (W @ v.reshape(len(v), 18)).reshape(-1, 3, 6)


def sky_cubes(model: Model, bodies) -> np.ndarray:
    """(M, 3, 6) float64: the sky bodies' bounce at the probes, as the browser folds it into the scenario volume: on the
    basis grid S1 = sum over the bodies of RGB x sum_k c_k basis_k (float16 widened, float64 sums), then to_probes."""
    S1 = np.zeros(model.sky.basis.shape[1:], np.float64)
    for s, rgb in bodies:
        S1 += sunbounce.bounce(model.sky.basis, body_coefficients(model, s)) * np.asarray(rgb, np.float64)[None, :, None]
    return to_probes(model, S1)


def multiplier(direct, normals, flags, pos, colour_lin, model: Model, setting: Setting, visibility: Visibility = NO_VISIBILITY,
               sky_probes=None):
    """(rgb (N, 3), alpha (N,)): the normative multiplier. sky_probes: sky_cubes(model, sky_bodies(setting)), for a caller
    that relights many splats in chunks under one setting (computed here when None; the same values either way)."""
    direct = np.asarray(direct, np.float64)
    n = np.asarray(normals, np.float64)
    flags = np.asarray(flags, np.uint8)
    C = np.asarray(colour_lin, np.float64)
    P = np.asarray(pos, np.float64)
    cls = flags & codec.CLASS_MASK
    iso = (flags & codec.FLAG_ISO) > 0
    idx, wts = trilinear(model, P)
    cubes = (model.probes[idx].astype(np.float64) * wts[:, :, None, None, None]).sum(1)   # (N, 9, 3, 6)
    I = cube_eval(cubes, n, iso)                                                          # (N, 9, 3)
    light = direct[:, :, None] + I
    Ecap = (light * (model.capture_w[:, None] * model.capture_c)[None]).sum(1)
    E = (light * setting.weights[None]).sum(1)
    bodies = sky_bodies(setting)
    if bodies and model.volumes:
        reach = (flags & codec.FLAG_SUN) > 0
        for s, rgb in bodies:
            # the body's direct light: the window volume march, the owner's horizon gate and the glass (float32 inside)
            vis = np.zeros(len(n))
            if reach.any():
                vis[reach] = sun_visibility(model.volumes, model.horizons, model.fresnel, P[reach], s)
            cosv = np.where(iso, 0.25, np.clip(n @ s, 0, None))
            E = E + (vis * cosv)[:, None] * rgb[None]
        if model.sky is not None:
            # both bodies' bounce: the basis at the probes, then the same trilinear lookup and ambient cube as I[k]
            cubes_sky = sky_cubes(model, bodies) if sky_probes is None else sky_probes
            sky = (cubes_sky[idx] * wts[:, :, None, None]).sum(1)                         # (N, 3, 6)
            E = E + cube_eval(sky[:, None], n, iso)[:, 0]
    L = C @ LUMW
    # Both sides of every ratio take the same 1e-4 guard, so the captured setting (E = Ecap, rBack = 1) gives M = 1
    # exactly on every channel, a splat with no captured light (Ecap < 1e-4) and an embrasure channel stored as an sRGB
    # byte of 0 (C < 1e-4) included (amended 11 October, Task 5 fix round 1, C1).
    M = np.maximum(E, 1e-4) / np.maximum(Ecap, 1e-4)
    emb = cls == codec.CLASS_EMBRASURE
    if emb.any():
        Cp = np.maximum(C[emb], 1e-4)
        rho = np.minimum(Cp / np.maximum(Ecap[emb], 1e-4), 0.8)
        excess = np.maximum(Cp - rho * Ecap[emb], 0.0)
        r_back = setting.sky_level * setting.sky_colour / np.maximum(model.daylight_colour, 1e-6)
        M[emb] = (rho * E[emb] + excess * r_back[None]) / Cp
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
        tint = np.array([setting.lamp_tints[g] for g in group[fx]], np.float64)
        lit = np.where(bulb, (1.0 + (setting.emitter_boost - 1.0) * smoothstep(0.45, 0.9, L[fx]))[:, None] * tint,
                       np.where(cove, tint, M[fx]))
        chroma = np.clip(C[fx] / np.maximum(L[fx], 1e-4)[:, None], 0.5, 2.0) ** 0.4
        A = np.where((c_fx == codec.CLASS_DOME_EMITTER)[:, None], 0.5, 0.35) * chroma
        A = np.where(cove, 0.3, A)
        unlit = A * E[fx] / np.maximum(C[fx], 1e-4)
        M[fx] = np.clip(level * lit + (1 - level) * unlit, 0.0, 8.0)
    group = (flags >> codec.SKIN_GROUP_SHIFT).astype(np.int64)
    toggle = (flags >> codec.TOGGLE_SHIFT).astype(np.int64)
    covered = (cls == codec.CLASS_SKIN) & (((visibility.skin_groups >> group) & 1) == 1)
    toggled = (cls != codec.CLASS_SKIN) & (toggle > 0) & (((visibility.hidden_toggles >> np.maximum(toggle - 1, 0)) & 1) == 1)
    alpha = np.where((cls == codec.CLASS_HIDDEN) | covered | toggled, 0.0, 1.0)
    return M, alpha
