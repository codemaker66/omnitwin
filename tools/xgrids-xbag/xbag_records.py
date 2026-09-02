"""XGRIDS PortalCam XBAG (.xbin) camera frame records.

What was established on the Grand Hall capture (2026-09-02, T-570):

- The container starts with an ``XBAG`` header, a device-info protobuf, a
  compressed channel table, and at byte 4,563 a uint32-prefixed block of six
  factory-calibration records (the T-566 lane parsed those).
- After that the body is a flat run of protobuf messages. Every camera frame is
  one ``field 1`` message whose body is::

      f1  bytes   metadata { f1 varint seq (omitted when 0),
                             f2 varint ZigZag microsecond timestamp,
                             f3 varint 20000 }
      f2  varint  codec tag, 3 for H.264
      f3  varint  width   (4000)
      f4  varint  height  (3000)
      f5  bytes   one H.264 Annex-B access unit: SPS, PPS, SEI, IDR
      f6  bytes   encoder statistics

- Every stored frame is an intra keyframe, so every frame begins with an SPS
  start code (``00 00 00 01 67``). The four cameras share this stream and are
  written back to back with the same ``seq`` and timestamps within a few tens
  of microseconds; nothing in the record names the camera, so identity comes
  from the position within that co-timed group and from the optical class of
  the picture (two rectilinear pinhole cameras, two 200-degree fisheyes whose
  circle leaves black corners).

The parser locates a record from its SPS: it walks back over the ``f5`` tag to
the record start, refuses anything whose bytes do not form the message above,
and never reads outside the buffer. It holds no file handles; callers pass a
``bytes``-like object (an ``mmap`` in production). Video decoding is not done
here; ``xbag_extract.py`` isolates that behind an optional dependency.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Iterator, Sequence

SPS_START_CODE = b"\x00\x00\x00\x01\x67"
CODEC_TAG_H264 = 3
_WIRE_VARINT = 0
_WIRE_BYTES = 2
_F5_TAG = 0x2A  # field 5, length-delimited
_F1_TAG = 0x0A  # field 1, length-delimited
_MAX_META_BYTES = 32
_MAX_RECORD_HEAD_BYTES = 48
_FISHEYE_CORNER_MAX = 12.0
_FISHEYE_CORNER_RATIO = 0.25


@dataclass(frozen=True)
class FrameRecord:
    """One camera frame located inside an XBAG buffer."""

    record_offset: int
    seq: int
    ts_us: int
    codec_tag: int
    width: int
    height: int
    payload_offset: int
    payload_length: int

    @property
    def payload_end(self) -> int:
        return self.payload_offset + self.payload_length


class OpticalClass(str, Enum):
    RECTILINEAR = "rectilinear"
    FISHEYE = "fisheye"


class _Truncated(ValueError):
    pass


def _varint(buf: bytes | memoryview, pos: int, end: int) -> tuple[int, int]:
    value = 0
    shift = 0
    for _ in range(10):
        if pos >= end:
            raise _Truncated("varint runs past the buffer")
        byte = buf[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, pos
        shift += 7
    raise _Truncated("varint longer than ten bytes")


def _zigzag(value: int) -> int:
    return (value >> 1) ^ -(value & 1)


def _fields(buf: bytes | memoryview, start: int, end: int) -> dict[int, list[tuple[str, int, int]]]:
    """Field number -> [(kind, value_or_offset, length)]. Bytes fields are recorded by offset, never copied."""
    out: dict[int, list[tuple[str, int, int]]] = {}
    pos = start
    while pos < end:
        tag, pos = _varint(buf, pos, end)
        number, wire = tag >> 3, tag & 7
        if wire == _WIRE_VARINT:
            value, pos = _varint(buf, pos, end)
            out.setdefault(number, []).append(("varint", value, 0))
        elif wire == _WIRE_BYTES:
            length, pos = _varint(buf, pos, end)
            if pos + length > end:
                raise _Truncated("length-delimited field runs past the buffer")
            out.setdefault(number, []).append(("bytes", pos, length))
            pos += length
        else:
            raise _Truncated("unexpected wire type in a frame record")
    return out


def _first_varint(fields: dict[int, list[tuple[str, int, int]]], number: int) -> int | None:
    for kind, value, _ in fields.get(number, []):
        if kind == "varint":
            return value
    return None


def parse_record_at_sps(buf: bytes | memoryview, sps_offset: int) -> FrameRecord | None:
    """Parse the frame record whose H.264 payload begins at ``sps_offset``.

    Returns ``None`` when the bytes around the start code are not a record:
    a start code that occurs inside some other payload, or a record whose
    declared payload runs past the buffer.
    """
    end = len(buf)
    if sps_offset < 0 or sps_offset + len(SPS_START_CODE) > end:
        return None
    if bytes(buf[sps_offset : sps_offset + len(SPS_START_CODE)]) != SPS_START_CODE:
        return None
    # The f5 tag and its length varint sit immediately before the payload.
    f5_offset = None
    payload_length = None
    # tag byte + a length varint of one to ten bytes
    for back in range(2, 12):
        candidate = sps_offset - back
        if candidate < 0 or buf[candidate] != _F5_TAG:
            continue
        try:
            length, after = _varint(buf, candidate + 1, sps_offset + 1)
        except _Truncated:
            continue
        if after == sps_offset:
            f5_offset, payload_length = candidate, length
            break
    if f5_offset is None or payload_length is None or payload_length <= 0:
        return None
    if sps_offset + payload_length > end:
        return None
    # The record starts at the metadata's f1 tag, a short length-delimited message.
    for back in range(4, _MAX_RECORD_HEAD_BYTES):
        record_offset = f5_offset - back
        if record_offset < 0:
            break
        if buf[record_offset] != _F1_TAG:
            continue
        try:
            meta_length, meta_start = _varint(buf, record_offset + 1, f5_offset)
        except _Truncated:
            continue
        if not 2 <= meta_length <= _MAX_META_BYTES or meta_start + meta_length > f5_offset:
            continue
        try:
            meta = _fields(buf, meta_start, meta_start + meta_length)
            head = _fields(buf, meta_start + meta_length, f5_offset)
        except _Truncated:
            continue
        ts_raw = _first_varint(meta, 2)
        codec = _first_varint(head, 2)
        width = _first_varint(head, 3)
        height = _first_varint(head, 4)
        if ts_raw is None or codec is None or width is None or height is None:
            continue
        seq = _first_varint(meta, 1) or 0
        return FrameRecord(
            record_offset=record_offset,
            seq=seq,
            ts_us=_zigzag(ts_raw),
            codec_tag=codec,
            width=width,
            height=height,
            payload_offset=sps_offset,
            payload_length=payload_length,
        )
    return None


def scan_keyframes(buf: bytes | memoryview, start: int = 0) -> Iterator[FrameRecord]:
    """Yield every frame record in ``buf`` in file order, skipping start codes that are not records."""
    pos = buf.find(SPS_START_CODE, start)
    while pos != -1:
        record = parse_record_at_sps(buf, pos)
        if record is None:
            pos = buf.find(SPS_START_CODE, pos + 1)
            continue
        yield record
        pos = buf.find(SPS_START_CODE, record.payload_end)


def group_cotimed(records: Iterable[FrameRecord], tolerance_us: int = 2000) -> Iterator[Sequence[FrameRecord]]:
    """Group records that share ``seq`` and a timestamp within ``tolerance_us``: one group per instant, one member per camera.

    The writer does not always place a camera's frames next to each other; early
    in the Grand Hall capture it emits runs of one camera before the next. So
    grouping is by time, not adjacency: records are ordered by timestamp, runs
    that share a sequence number within the tolerance become one group, and
    each group keeps its members in file order.
    """
    ordered = sorted(records, key=lambda record: (record.ts_us, record.record_offset))
    group: list[FrameRecord] = []
    for record in ordered:
        if group and record.seq == group[0].seq and abs(record.ts_us - group[0].ts_us) <= tolerance_us:
            group.append(record)
            continue
        if group:
            yield tuple(sorted(group, key=lambda member: member.record_offset))
        group = [record]
    if group:
        yield tuple(sorted(group, key=lambda member: member.record_offset))


def classify_optical(corner_mean: float, image_mean: float) -> OpticalClass:
    """A fisheye picture leaves its corners black outside the lens circle; a rectilinear one fills them.

    Corners are judged relative to the picture so a dark scene is not mistaken
    for a lens circle.
    """
    if corner_mean <= _FISHEYE_CORNER_MAX and image_mean > 0 and corner_mean / image_mean <= _FISHEYE_CORNER_RATIO:
        return OpticalClass.FISHEYE
    return OpticalClass.RECTILINEAR
