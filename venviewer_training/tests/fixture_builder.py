"""Deterministic builders for the local COLMAP/depth contract fixture.

The fixture is deliberately tiny but exercises the mistakes the production
preflight needs to catch:

* two PINHOLE cameras with different intrinsics and resolutions;
* three registered image ids that are non-contiguous and serialized out of
  order;
* an explicit two-image training split and one-image held-out split; and
* a complete ``images_2`` runtime directory with exact half-resolution PNGs;
* sparse depth priors for training images only.

No fixture byte contains a timestamp or host path.  NPZ members use fixed ZIP
metadata so rebuilding in another temporary directory produces identical
bytes and hashes.
"""

from __future__ import annotations

import io
import json
import struct
import zipfile
import zlib
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np


def _png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + chunk_type
        + payload
        + struct.pack(">I", zlib.crc32(chunk_type + payload) & 0xFFFFFFFF)
    )


def _png_bytes(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    if width <= 0 or height <= 0:
        raise ValueError("PNG dimensions must be positive")
    if any(channel < 0 or channel > 255 for channel in rgb):
        raise ValueError("PNG colour channels must be bytes")
    pixel = bytes(rgb)
    scanline = b"\x00" + pixel * width
    raw = scanline * height
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(raw, level=9))
        + _png_chunk(b"IEND", b"")
    )


def _cameras_binary(
    records: Sequence[tuple[int, int, int, int, Sequence[float]]],
) -> bytes:
    payload = bytearray(struct.pack("<Q", len(records)))
    for camera_id, model_id, width, height, params in records:
        payload += struct.pack("<iiQQ", camera_id, model_id, width, height)
        payload += struct.pack("<" + "d" * len(params), *params)
    return bytes(payload)


def _image_record(
    image_id: int,
    name: str,
    *,
    camera_id: int,
    qvec: tuple[float, float, float, float],
    tvec: tuple[float, float, float],
    observations: Sequence[tuple[float, float, int]],
) -> bytes:
    encoded_name = name.encode("utf-8")
    if b"\0" in encoded_name:
        raise ValueError("COLMAP image names cannot contain NUL")
    payload = bytearray(struct.pack("<i7di", image_id, *qvec, *tvec, camera_id))
    payload += encoded_name + b"\0"
    payload += struct.pack("<Q", len(observations))
    for x, y, point3d_id in observations:
        payload += struct.pack("<ddq", x, y, point3d_id)
    return bytes(payload)


def _images_binary(records: Iterable[bytes]) -> bytes:
    materialized = list(records)
    return struct.pack("<Q", len(materialized)) + b"".join(materialized)


def _points3d_binary(
    records: Sequence[
        tuple[
            int,
            tuple[float, float, float],
            tuple[int, int, int],
            float,
            Sequence[tuple[int, int]],
        ]
    ],
) -> bytes:
    payload = bytearray(struct.pack("<Q", len(records)))
    for point_id, xyz, rgb, error, track in records:
        payload += struct.pack("<QdddBBBd", point_id, *xyz, *rgb, error)
        payload += struct.pack("<Q", len(track))
        for image_id, observation_index in track:
            payload += struct.pack("<ii", image_id, observation_index)
    return bytes(payload)


def _npy_bytes(array: np.ndarray) -> bytes:
    stream = io.BytesIO()
    materialized = np.asarray(array)
    if materialized.ndim > 0:
        materialized = np.ascontiguousarray(materialized)
    np.lib.format.write_array(
        stream,
        materialized,
        version=(1, 0),
        allow_pickle=False,
    )
    return stream.getvalue()


def _deterministic_npz_bytes(**arrays: np.ndarray) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(
        stream,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        strict_timestamps=True,
    ) as archive:
        for name in sorted(arrays):
            member = zipfile.ZipInfo(f"{name}.npy", date_time=(1980, 1, 1, 0, 0, 0))
            member.compress_type = zipfile.ZIP_DEFLATED
            member.create_system = 3
            member.external_attr = 0o100600 << 16
            archive.writestr(member, _npy_bytes(arrays[name]), compresslevel=9)
    return stream.getvalue()


def _depth_npz_bytes(
    *,
    width: int,
    height: int,
    uv: Sequence[tuple[float, float]],
    depth_m: Sequence[float],
) -> bytes:
    return _deterministic_npz_bytes(
        uv=np.asarray(uv, dtype=np.float32),
        depth_m=np.asarray(depth_m, dtype=np.float32),
        width=np.asarray(width, dtype=np.int32),
        height=np.asarray(height, dtype=np.int32),
    )


def build_valid_colmap_fixture(root: Path) -> tuple[Path, Path]:
    """Create a fresh deterministic fixture and return dataset/depth roots."""

    root = Path(root)
    dataset_root = root / "dataset"
    depth_dir = root / "depths"
    if dataset_root.exists() or depth_dir.exists():
        raise FileExistsError("fixture target already exists; refusing to overwrite it")
    images_dir = dataset_root / "images"
    images_2_dir = dataset_root / "images_2"
    sparse_dir = dataset_root / "sparse" / "0"
    images_dir.mkdir(parents=True)
    images_2_dir.mkdir(parents=True)
    sparse_dir.mkdir(parents=True)
    depth_dir.mkdir(parents=True)

    # Records are intentionally serialized as camera 19 then camera 7.
    # Both use model id 1 (PINHOLE), but their resolutions and intrinsics differ.
    cameras = _cameras_binary(
        [
            (19, 1, 10, 8, (8.0, 8.5, 5.0, 4.0)),
            (7, 1, 8, 6, (6.0, 6.5, 4.0, 3.0)),
        ]
    )

    # Image ids are deliberately non-contiguous and out of order.  Tracks and
    # observations are reciprocal so the contract can validate both directions.
    images = _images_binary(
        [
            _image_record(
                41,
                "heldout.png",
                camera_id=19,
                qvec=(1.0, 0.0, 0.0, 0.0),
                tvec=(0.25, 0.0, 0.0),
                observations=((6.0, 4.0, 2003),),
            ),
            _image_record(
                3,
                "train-a.png",
                camera_id=7,
                qvec=(1.0, 0.0, 0.0, 0.0),
                tvec=(0.0, 0.0, 0.0),
                observations=((2.0, 2.0, 1001), (3.0, 2.0, 2003)),
            ),
            _image_record(
                101,
                "train-b.png",
                camera_id=19,
                qvec=(1.0, 0.0, 0.0, 0.0),
                tvec=(-0.25, 0.0, 0.0),
                observations=((5.0, 4.0, 1001),),
            ),
        ]
    )
    points = _points3d_binary(
        [
            (1001, (0.0, 0.0, 2.0), (220, 80, 40), 0.1, ((3, 0), (101, 0))),
            (2003, (1.0, 0.0, 3.0), (40, 120, 220), 0.2, ((41, 0), (3, 1))),
        ]
    )
    (sparse_dir / "cameras.bin").write_bytes(cameras)
    (sparse_dir / "images.bin").write_bytes(images)
    (sparse_dir / "points3D.bin").write_bytes(points)

    (images_dir / "heldout.png").write_bytes(_png_bytes(10, 8, (30, 50, 70)))
    (images_dir / "train-a.png").write_bytes(_png_bytes(8, 6, (120, 60, 20)))
    (images_dir / "train-b.png").write_bytes(_png_bytes(10, 8, (20, 100, 160)))

    # Config B uses data_factor=2.  The pinned parser consumes images_2 and
    # expects each camera dimension divided by two exactly.
    (images_2_dir / "heldout.png").write_bytes(_png_bytes(5, 4, (30, 50, 70)))
    (images_2_dir / "train-a.png").write_bytes(_png_bytes(4, 3, (120, 60, 20)))
    (images_2_dir / "train-b.png").write_bytes(_png_bytes(5, 4, (20, 100, 160)))

    # This is the exact gsplat v1.5.3 rule at test_every=8: sort filenames,
    # hold out index 0, and train on every index whose modulo is non-zero.
    splits = {"train": ["train-a.png", "train-b.png"], "heldout": ["heldout.png"]}
    (dataset_root / "splits.json").write_text(
        json.dumps(splits, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    (depth_dir / "train-a.npz").write_bytes(
        _depth_npz_bytes(
            width=8,
            height=6,
            uv=((1.0, 1.0), (6.0, 4.0)),
            depth_m=(2.0, 3.0),
        )
    )
    (depth_dir / "train-b.npz").write_bytes(
        _depth_npz_bytes(
            width=10,
            height=8,
            uv=((2.0, 2.0), (8.0, 6.0)),
            depth_m=(2.5, 3.5),
        )
    )
    return dataset_root, depth_dir


# Descriptive aliases make the helper convenient in focused tests without
# changing the single implementation or fixture bytes.
create_valid_colmap_fixture = build_valid_colmap_fixture
build_colmap_training_fixture = build_valid_colmap_fixture


__all__ = [
    "build_valid_colmap_fixture",
    "create_valid_colmap_fixture",
    "build_colmap_training_fixture",
]
