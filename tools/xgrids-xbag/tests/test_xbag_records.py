"""Tests for the XGRIDS XBAG frame-record parser.

Fixtures are synthetic: the test encodes records with the same wire layout the
Grand Hall container was observed to use (protobuf varints, a ZigZag
timestamp, an H.264 Annex-B payload as field 5), so no capture file is read.
"""

from __future__ import annotations

import unittest

from xbag_records import (
    FrameRecord,
    OpticalClass,
    classify_optical,
    group_cotimed,
    scan_keyframes,
    parse_record_at_sps,
)

SPS = b"\x00\x00\x00\x01\x67\x64\x10\x3c"
PPS = b"\x00\x00\x00\x01\x68\xee\x31\xb2"
IDR = b"\x00\x00\x00\x01\x65\x88\x84\x00"


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _zigzag(value: int) -> int:
    return (value << 1) ^ (value >> 63)


def _field_varint(number: int, value: int) -> bytes:
    return _varint((number << 3) | 0) + _varint(value)


def _field_bytes(number: int, payload: bytes) -> bytes:
    return _varint((number << 3) | 2) + _varint(len(payload)) + payload


def encode_record(seq: int, ts_us: int, payload: bytes, *, width: int = 4000, height: int = 3000) -> bytes:
    """One frame record exactly as observed: f1 metadata{f1 seq, f2 zigzag ts, f3 20000}, f2=3, f3 w, f4 h, f5 h264, f6 stats."""
    meta = b""
    if seq:
        meta += _field_varint(1, seq)
    meta += _field_varint(2, _zigzag(ts_us)) + _field_varint(3, 20000)
    stats = _field_varint(2, 213988) + _field_varint(3, 4590) + _field_varint(4, 15992) + _field_varint(5, 3200)
    body = (
        _field_bytes(1, meta)
        + _field_varint(2, 3)
        + _field_varint(3, width)
        + _field_varint(4, height)
        + _field_bytes(5, payload)
        + _field_bytes(6, stats)
    )
    return _field_bytes(1, body)


def access_unit(filler: bytes = b"\x00" * 64) -> bytes:
    return SPS + PPS + IDR + filler


class ParseRecordAtSps(unittest.TestCase):
    def test_recovers_metadata_dimensions_and_payload_extent(self) -> None:
        au = access_unit()
        blob = b"\xc2\x8d\xd7\x78" + encode_record(1267, 1780219539649479, au)
        sps = blob.find(SPS)
        record = parse_record_at_sps(blob, sps)
        self.assertIsInstance(record, FrameRecord)
        assert record is not None
        self.assertEqual(record.seq, 1267)
        self.assertEqual(record.ts_us, 1780219539649479)
        self.assertEqual(record.codec_tag, 3)
        self.assertEqual((record.width, record.height), (4000, 3000))
        self.assertEqual(record.payload_offset, sps)
        self.assertEqual(record.payload_length, len(au))
        self.assertEqual(blob[record.payload_offset : record.payload_offset + record.payload_length], au)

    def test_first_frame_omits_the_zero_sequence_field(self) -> None:
        blob = encode_record(0, 1780219117818401, access_unit())
        record = parse_record_at_sps(blob, blob.find(SPS))
        assert record is not None
        self.assertEqual(record.seq, 0)
        self.assertEqual(record.ts_us, 1780219117818401)

    def test_refuses_a_start_code_that_is_not_a_record_payload(self) -> None:
        # A start code inside arbitrary bytes has no f5 tag before it and no metadata message.
        blob = b"\x11\x22\x33\x44" + SPS + b"\x55" * 32
        self.assertIsNone(parse_record_at_sps(blob, blob.find(SPS)))

    def test_refuses_a_payload_length_that_overruns_the_buffer(self) -> None:
        au = access_unit()
        blob = encode_record(5, 1780219118000000, au)
        truncated = blob[: len(blob) - 40]
        self.assertIsNone(parse_record_at_sps(truncated, truncated.find(SPS)))


class ScanKeyframes(unittest.TestCase):
    def test_indexes_every_record_and_skips_false_start_codes(self) -> None:
        records = [encode_record(i, 1780219117818401 + 300000 * i, access_unit(bytes([i]) * 40)) for i in range(5)]
        decoy = b"\x00\x00\x00\x01\x67" + b"\x99" * 20   # a start code with no record around it
        blob = records[0] + records[1] + decoy + records[2] + records[3] + records[4]
        found = list(scan_keyframes(blob))
        self.assertEqual([r.seq for r in found], [0, 1, 2, 3, 4])
        self.assertTrue(all(r.width == 4000 for r in found))
        # offsets are monotonic and each payload is the access unit that was encoded
        self.assertEqual([blob[r.payload_offset : r.payload_offset + 8] for r in found], [SPS] * 5)


class GroupCotimed(unittest.TestCase):
    def test_groups_records_sharing_a_sequence_and_an_instant(self) -> None:
        t = 1780219539649467
        recs = [
            FrameRecord(record_offset=0, seq=1267, ts_us=t + 21, codec_tag=3, width=4000, height=3000, payload_offset=30, payload_length=10),
            FrameRecord(record_offset=100, seq=1267, ts_us=t, codec_tag=3, width=4000, height=3000, payload_offset=130, payload_length=10),
            FrameRecord(record_offset=200, seq=1267, ts_us=t + 12, codec_tag=3, width=4000, height=3000, payload_offset=230, payload_length=10),
            FrameRecord(record_offset=300, seq=1267, ts_us=t + 17, codec_tag=3, width=4000, height=3000, payload_offset=330, payload_length=10),
            FrameRecord(record_offset=400, seq=1268, ts_us=t + 300_000, codec_tag=3, width=4000, height=3000, payload_offset=430, payload_length=10),
        ]
        groups = list(group_cotimed(recs, tolerance_us=2000))
        self.assertEqual([len(g) for g in groups], [4, 1])
        self.assertEqual([r.record_offset for r in groups[0]], [0, 100, 200, 300])

    def test_groups_cameras_that_are_written_in_blocks_rather_than_adjacent(self) -> None:
        # Early in the Grand Hall capture the writer emits ~5 frames of one camera,
        # then the same seq numbers for the next camera: A10 A11 B10 B11.
        t = 1780219120916415
        a10 = FrameRecord(record_offset=0, seq=10, ts_us=t + 11, codec_tag=3, width=4000, height=3000, payload_offset=30, payload_length=10)
        a11 = FrameRecord(record_offset=100, seq=11, ts_us=t + 500_000 + 18, codec_tag=3, width=4000, height=3000, payload_offset=130, payload_length=10)
        b10 = FrameRecord(record_offset=200, seq=10, ts_us=t, codec_tag=3, width=4000, height=3000, payload_offset=230, payload_length=10)
        b11 = FrameRecord(record_offset=300, seq=11, ts_us=t + 500_000, codec_tag=3, width=4000, height=3000, payload_offset=330, payload_length=10)
        groups = list(group_cotimed([a10, a11, b10, b11], tolerance_us=2000))
        self.assertEqual([[r.record_offset for r in g] for g in groups], [[0, 200], [100, 300]])

    def test_does_not_merge_frames_that_share_a_sequence_but_not_an_instant(self) -> None:
        t = 1780219539649467
        recs = [
            FrameRecord(record_offset=0, seq=7, ts_us=t, codec_tag=3, width=4000, height=3000, payload_offset=30, payload_length=10),
            FrameRecord(record_offset=100, seq=7, ts_us=t + 5_000_000, codec_tag=3, width=4000, height=3000, payload_offset=130, payload_length=10),
        ]
        self.assertEqual([len(g) for g in group_cotimed(recs, tolerance_us=2000)], [1, 1])


class ClassifyOptical(unittest.TestCase):
    def test_black_corners_mean_a_fisheye_circle(self) -> None:
        self.assertEqual(classify_optical(corner_mean=4.7, image_mean=59.5), OpticalClass.FISHEYE)

    def test_bright_corners_mean_a_rectilinear_frame(self) -> None:
        self.assertEqual(classify_optical(corner_mean=123.4, image_mean=112.8), OpticalClass.RECTILINEAR)

    def test_a_dark_scene_is_not_mistaken_for_a_fisheye(self) -> None:
        # corners as dark as the frame itself: no circle is implied
        self.assertEqual(classify_optical(corner_mean=9.0, image_mean=10.0), OpticalClass.RECTILINEAR)



class ExtractCli(unittest.TestCase):
    """The CLI's pure parts: index a buffer to CSV and write one access unit out."""

    def test_index_and_extract_round_trip(self) -> None:
        import csv, os, tempfile
        from xbag_extract import extract_access_unit, write_index

        records = [encode_record(i, 1780219117818401 + 300000 * i, access_unit(bytes([i]) * 40)) for i in range(3)]
        blob = b"".join(records)
        with tempfile.TemporaryDirectory() as tmp:
            index_path = os.path.join(tmp, "keyframes.csv")
            count = write_index(blob, index_path)
            self.assertEqual(count, 3)
            rows = list(csv.DictReader(open(index_path, newline="")))
            self.assertEqual([r["seq"] for r in rows], ["0", "1", "2"])
            self.assertEqual(rows[1]["ts_us"], str(1780219117818401 + 300000))
            self.assertEqual(rows[0]["width"], "4000")
            out = os.path.join(tmp, "frame.h264")
            written = extract_access_unit(blob, int(rows[2]["payload_offset"]), out)
            self.assertEqual(written, len(access_unit(bytes([2]) * 40)))
            self.assertEqual(open(out, "rb").read(), access_unit(bytes([2]) * 40))

    def test_extract_refuses_an_offset_that_is_not_a_record(self) -> None:
        import os, tempfile
        from xbag_extract import extract_access_unit

        blob = b"\x00" * 16 + b"\x00\x00\x00\x01\x67" + b"\x00" * 16
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "frame.h264")
            with self.assertRaises(ValueError):
                extract_access_unit(blob, 16, out)
            self.assertFalse(os.path.exists(out))

if __name__ == "__main__":
    unittest.main()
