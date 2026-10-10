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

# Skins (R1c, amendment A1): a splat a skin covers is class 7, its wall group in bits 5-7 (0 door wall, 1 window wall,
# 2 end_xmin, 3 end_xmax, 4 ceiling; 7 reserved, so no record's flags byte is R1b's pass-through 0xff), lit exactly as
# class 0 and hidden while its group's skins draw. Any other class may carry a toggle in bits 6-7 (bit 5 stays the
# chandelier group): 1 the loose clutter, 2 the AV cabinet; a toggled splat is hidden while its toggle is.
CLASS_SKIN = 7
SKIN_GROUP_SHIFT = 5
SKIN_GROUP_MAX = 6
TOGGLE_SHIFT = 6
TOGGLE_NONE, TOGGLE_CLUTTER, TOGGLE_CABINET = 0, 1, 2

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
    return np.where((f & CLASS_MASK) == CLASS_SKIN, (f >> SKIN_GROUP_SHIFT).astype(np.int64), -1)


def toggle_of(flags):
    f = np.asarray(flags, dtype=np.uint8)
    return np.where((f & CLASS_MASK) == CLASS_SKIN, 0, f >> TOGGLE_SHIFT).astype(np.int64)


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
