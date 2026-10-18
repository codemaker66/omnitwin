"""GHR1 relief files in Python: a port of parseWallRelief (packages/web/src/components/
grand-hall/hall-relief.ts) that also checks the container's rules, and a small writer for tests.

  "GHR1", u32 entryCount, then per entry (4-byte aligned):
  char[12] id, u32 vertexCount, u32 triangleCount, u32 indexBytes (2|4),
  f32[6] ranges (u0 u1 v0 v1 d0 d1), u16[vertexCount*3] quantised (u, v, depth),
  indices (u16|u32)[triangleCount*3]
"""
import struct

import numpy as np

MAGIC = b"GHR1"
HEADER_BYTES = 48


class ReliefError(ValueError):
    pass


def _align(offset):
    return (offset + 3) & ~3


def parse(data, known_ids=None):
    """Entries of a GHR1 file as dicts (id, ranges, quantised, indices, positions), rejecting
    anything hall-relief.ts would reject, plus ids over 12 bytes or not ASCII and padding that is
    not zero. known_ids, when given, is the set of ids the reader accepts."""
    if len(data) < 8 or data[:4] != MAGIC:
        raise ReliefError("not a relief file")
    count = struct.unpack_from("<I", data, 4)[0]
    offset = 8
    entries, seen = [], set()
    for _ in range(count):
        if offset + HEADER_BYTES > len(data):
            raise ReliefError("truncated header")
        raw_id = data[offset:offset + 12]
        ident = raw_id.rstrip(b"\0")
        if b"\0" in ident or not ident or any(b < 0x20 or b > 0x7e for b in ident):
            raise ReliefError(f"bad id {raw_id!r}")
        ident = ident.decode("ascii")
        if known_ids is not None and ident not in known_ids:
            raise ReliefError(f"unknown id {ident!r}")
        if ident in seen:
            raise ReliefError(f"id {ident!r} twice")
        seen.add(ident)
        vertex_count, triangle_count, index_bytes = struct.unpack_from("<III", data, offset + 12)
        if index_bytes not in (2, 4):
            raise ReliefError(f"index size {index_bytes}")
        if index_bytes == 2 and vertex_count > 65536:
            raise ReliefError("16-bit indices for too many vertices")
        ranges = struct.unpack_from("<6f", data, offset + 24)
        for axis in range(3):
            lo, hi = ranges[axis * 2], ranges[axis * 2 + 1]
            if not (np.isfinite(lo) and np.isfinite(hi) and hi > lo):
                raise ReliefError(f"range {lo}..{hi}")
        offset += HEADER_BYTES
        vertex_bytes = vertex_count * 6
        if offset + vertex_bytes > len(data):
            raise ReliefError("truncated vertices")
        quantised = np.frombuffer(data, np.uint16, vertex_count * 3, offset).reshape(-1, 3)
        end = offset + vertex_bytes
        offset = _align(end)
        if any(data[end:offset]):
            raise ReliefError("non-zero padding after the vertices")
        index_total = triangle_count * 3 * index_bytes
        if offset + index_total > len(data):
            raise ReliefError("truncated indices")
        indices = np.frombuffer(data, np.uint16 if index_bytes == 2 else np.uint32, triangle_count * 3, offset).astype(np.uint32)
        end = offset + index_total
        offset = _align(end)
        if any(data[end:offset]):
            raise ReliefError("non-zero padding after the indices")
        if len(indices) and int(indices.max()) >= vertex_count:
            raise ReliefError(f"index {int(indices.max())} past {vertex_count} vertices")
        lo = np.array(ranges[0::2], np.float64)
        hi = np.array(ranges[1::2], np.float64)
        positions = lo + quantised.astype(np.float64) / 65535 * (hi - lo)
        entries.append(dict(id=ident, ranges=ranges, quantised=quantised, indices=indices.reshape(-1, 3),
                            positions=positions, index_bytes=index_bytes))
    if offset != len(data):
        raise ReliefError(f"{len(data) - offset} bytes after the last entry")
    return entries


def write(entries):
    """A GHR1 file from entries {id, ranges, quantised (N x 3 uint16), indices (M x 3)}."""
    out = bytearray(MAGIC + struct.pack("<I", len(entries)))
    for e in entries:
        quantised = np.asarray(e["quantised"], np.uint16).reshape(-1, 3)
        indices = np.asarray(e["indices"]).reshape(-1)
        index_bytes = 2 if len(quantised) <= 65535 else 4
        ident = e["id"].encode("ascii")
        if len(ident) > 12:
            raise ReliefError(f"id {e['id']!r} longer than 12 bytes")
        out += ident.ljust(12, b"\0") + struct.pack("<III", len(quantised), len(indices) // 3, index_bytes)
        out += struct.pack("<6f", *e["ranges"])
        out += quantised.tobytes()
        out += b"\0" * (_align(len(out)) - len(out))
        out += indices.astype(np.uint16 if index_bytes == 2 else np.uint32).tobytes()
        out += b"\0" * (_align(len(out)) - len(out))
    return bytes(out)


def triangle_normals(entry):
    """Per triangle, the normal of (u, v, depth) positions: +depth for counter-clockwise faces
    seen from the depth side."""
    p = entry["positions"]
    a, b, c = p[entry["indices"][:, 0]], p[entry["indices"][:, 1]], p[entry["indices"][:, 2]]
    return np.cross(b - a, c - a)
