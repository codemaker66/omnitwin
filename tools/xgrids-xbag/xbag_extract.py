"""Index and extract camera frames from an XGRIDS XBAG (.xbin) capture.

Read-only on the source: the capture is memory-mapped and never written.

    python xbag_extract.py index   <capture.xbin> <keyframes.csv>
    python xbag_extract.py extract <capture.xbin> <payload_offset> <out.h264> [--png out.png]

``index`` walks every H.264 keyframe record (see ``xbag_records``) and writes
one CSV row per frame. ``extract`` copies one access unit out as raw Annex-B
bytes; with ``--png`` it also decodes it, which needs the optional ``av``
package (PyAV bundles FFmpeg). Nothing here touches the calibration; that is
the T-566 receipt's business.
"""

from __future__ import annotations

import argparse
import csv
import mmap
import sys
from pathlib import Path

from xbag_records import FrameRecord, parse_record_at_sps, scan_keyframes

INDEX_COLUMNS = (
    "record_offset",
    "seq",
    "ts_us",
    "codec_tag",
    "width",
    "height",
    "payload_offset",
    "payload_length",
)


def write_index(buf: bytes | memoryview | mmap.mmap, index_path: str | Path) -> int:
    """Write one CSV row per frame record found in ``buf``; returns the row count."""
    count = 0
    with open(index_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(INDEX_COLUMNS)
        for record in scan_keyframes(buf):
            writer.writerow([getattr(record, column) for column in INDEX_COLUMNS])
            count += 1
    return count


def extract_access_unit(buf: bytes | memoryview | mmap.mmap, payload_offset: int, out_path: str | Path) -> int:
    """Write the access unit whose payload starts at ``payload_offset``; returns the byte count.

    Raises ``ValueError`` when the offset is not the payload of a frame record,
    and writes nothing in that case.
    """
    record = parse_record_at_sps(buf, payload_offset)
    if record is None:
        raise ValueError(f"offset {payload_offset} is not the payload of an XBAG frame record")
    payload = bytes(buf[record.payload_offset : record.payload_end])
    Path(out_path).write_bytes(payload)
    return len(payload)


def decode_access_unit_to_png(h264_path: str | Path, png_path: str | Path) -> tuple[int, int]:
    """Decode one Annex-B access unit to a PNG; returns (width, height). Needs PyAV and Pillow."""
    import io

    import av  # optional dependency, imported here so the index path needs nothing beyond the stdlib
    from PIL import Image  # noqa: F401  (PyAV's to_image needs Pillow present)

    payload = Path(h264_path).read_bytes()
    with av.open(io.BytesIO(payload), format="h264") as container:
        for frame in container.decode(video=0):
            image = frame.to_image()
            image.save(png_path)
            return image.width, image.height
    raise ValueError(f"{h264_path}: the decoder produced no picture")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    index = sub.add_parser("index", help="write one CSV row per keyframe record")
    index.add_argument("capture")
    index.add_argument("index_csv")
    extract = sub.add_parser("extract", help="copy one access unit out as raw H.264")
    extract.add_argument("capture")
    extract.add_argument("payload_offset", type=int)
    extract.add_argument("out_h264")
    extract.add_argument("--png", help="also decode to this PNG (needs the optional av package)")
    args = parser.parse_args(argv)

    with open(args.capture, "rb") as handle:
        buf = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)
        try:
            if args.command == "index":
                count = write_index(buf, args.index_csv)
                print(f"{count} keyframe records -> {args.index_csv}")
                return 0
            written = extract_access_unit(buf, args.payload_offset, args.out_h264)
            record: FrameRecord | None = parse_record_at_sps(buf, args.payload_offset)
            assert record is not None
            print(f"seq {record.seq} ts_us {record.ts_us} {record.width}x{record.height}: {written} bytes -> {args.out_h264}")
            if args.png:
                width, height = decode_access_unit_to_png(args.out_h264, args.png)
                print(f"decoded {width}x{height} -> {args.png}")
            return 0
        finally:
            buf.close()


if __name__ == "__main__":
    sys.exit(main())
