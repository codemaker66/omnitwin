"""Extract or strictly check the native Grand Hall E57 Image2D evidence pack."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from io import BytesIO
import os
from pathlib import Path
import sys
from typing import Any, Callable, Iterator, Protocol
import warnings

from e57_image2d_evidence import (
    CaptureIdentity,
    DecodedJpeg,
    EvidenceProfile,
    GRAND_HALL_PROFILE,
    Image2DInput,
    Image2DRecord,
    build_image_record,
    build_manifest,
    build_receipt,
    publication_stage,
    validate_capture_identity,
    validate_data3d_guids,
    validate_record_set,
    verify_evidence_pack,
    write_image_record,
    write_manifest,
    write_receipt_last,
)
from e57_stage_guard import (
    StageContext,
    assert_disjoint_output,
    load_stage,
    verify_stage_file,
)


class EvidenceSource(Protocol):
    def data3d_guids(self) -> list[str]: ...

    def iter_images(self) -> Iterator[Image2DInput]: ...

    def close(self) -> None: ...


SourceFactory = Callable[[Path, EvidenceProfile], EvidenceSource]


@dataclass(frozen=True)
class SourceSnapshot:
    device: int
    inode: int
    size_bytes: int
    modified_ns: int


def _snapshot(path: Path) -> SourceSnapshot:
    metadata = path.stat()
    return SourceSnapshot(
        device=metadata.st_dev,
        inode=metadata.st_ino,
        size_bytes=metadata.st_size,
        modified_ns=metadata.st_mtime_ns,
    )


def _verify_source_before(stage: StageContext) -> SourceSnapshot:
    before = _snapshot(stage.primary_e57.path)
    verify_stage_file(stage.primary_e57)
    after = _snapshot(stage.primary_e57.path)
    if before != after:
        raise ValueError("staged E57 changed during the pre-extraction hash")
    return after


def _verify_source_after(stage: StageContext, expected: SourceSnapshot) -> None:
    before = _snapshot(stage.primary_e57.path)
    if before != expected:
        raise ValueError("staged E57 identity changed while evidence was read")
    verify_stage_file(stage.primary_e57)
    after = _snapshot(stage.primary_e57.path)
    if after != expected:
        raise ValueError("staged E57 changed during the post-extraction hash")


def _capture_identity(stage: StageContext) -> CaptureIdentity:
    source = stage.primary_e57
    return CaptureIdentity(
        capture_stage_plan_sha256=stage.plan_sha256,
        e57_target_relative_path=source.target_relative_path,
        e57_size_bytes=source.size_bytes,
        e57_sha256=source.sha256,
    )


def _require_safe_profile_output(output: Path, profile: EvidenceProfile) -> None:
    if profile != GRAND_HALL_PROFILE:
        return
    if os.name != "nt":
        raise ValueError("Grand Hall evidence publication requires Windows no-replace semantics")
    drive = output.drive
    if len(drive) != 2 or drive[1] != ":" or not drive[0].isalpha():
        raise ValueError("Grand Hall evidence output requires an ordinary local drive-letter path")
    if drive[0].upper() == "C":
        raise ValueError("Grand Hall evidence output cannot use the system C: drive")


def decode_jpeg_with_pillow(content: bytes) -> DecodedJpeg:
    try:
        from PIL import Image, ImageFile
    except ImportError as error:
        raise RuntimeError("Pillow is required for full JPEG validation") from error
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(BytesIO(content)) as image:
            detected_format = image.format or ""
            image.load()
            return DecodedJpeg(
                width=image.width,
                height=image.height,
                mode=image.mode,
                format=detected_format,
            )


def _required_value(node: Any, name: str, label: str) -> Any:
    if not node.isDefined(name):
        raise ValueError(f"{label} is missing required E57 child {name!r}")
    return node[name].value()


def _required_string(node: Any, name: str, label: str) -> str:
    value = _required_value(node, name, label)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label}.{name} must be a non-empty E57 string")
    return value


def _required_integer(node: Any, name: str, label: str) -> int:
    value = _required_value(node, name, label)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{label}.{name} must be an exact E57 integer")
    return value


def _defined_names(node: Any, names: tuple[str, ...]) -> list[str]:
    return [name for name in names if node.isDefined(name)]


def _blob_bytes(blob: Any, profile: EvidenceProfile) -> bytes:
    size = int(blob.byteCount())
    if not 4 <= size <= profile.maximum_blob_bytes:
        raise ValueError("embedded Image2D JPEG exceeds the evidence bounds")
    buffer = bytearray(size)
    blob.read(buffer, 0, size)
    return bytes(buffer)


class Pye57EvidenceSource:
    def __init__(self, path: Path, profile: EvidenceProfile) -> None:
        try:
            import pye57
        except ImportError as error:
            raise RuntimeError("pye57 is required at the E57 extraction boundary") from error
        self._capture = pye57.E57(str(path))
        self._profile = profile
        self._root = self._capture.image_file.root()

    def data3d_guids(self) -> list[str]:
        if not self._root.isDefined("data3D"):
            raise ValueError("staged E57 has no data3D section")
        scans = self._root["data3D"]
        if scans.childCount() != self._profile.data3d_count:
            raise ValueError("staged E57 Data3D count differs from the evidence profile")
        return [
            _required_string(scans[index], "guid", "Data3D")
            for index in range(scans.childCount())
        ]

    def iter_images(self) -> Iterator[Image2DInput]:
        if not self._root.isDefined("images2D"):
            raise ValueError("staged E57 has no images2D section")
        images = self._root["images2D"]
        if images.childCount() != self._profile.image2d_count:
            raise ValueError("staged E57 Image2D count differs from the evidence profile")
        for index in range(images.childCount()):
            yield self._read_image(images[index], index)

    def _read_image(self, image: Any, index: int) -> Image2DInput:
        representation_name = self._representation_name(image, index)
        representation = image[representation_name]
        blob_name = self._blob_name(representation, index)
        label = f"Image2D {index}"
        return Image2DInput(
            image_index=index,
            image_guid=_required_string(image, "guid", label),
            image_name=_required_string(image, "name", label),
            associated_data3d_guid=_required_string(image, "associatedData3DGuid", label),
            representation_name=representation_name,
            blob_name=blob_name,
            width=_required_integer(representation, "imageWidth", label),
            height=_required_integer(representation, "imageHeight", label),
            focal_length=float(_required_value(representation, "focalLength", label)),
            pixel_width=float(_required_value(representation, "pixelWidth", label)),
            pixel_height=float(_required_value(representation, "pixelHeight", label)),
            principal_point_x=float(
                _required_value(representation, "principalPointX", label)
            ),
            principal_point_y=float(
                _required_value(representation, "principalPointY", label)
            ),
            jpeg_bytes=_blob_bytes(representation[blob_name], self._profile),
        )

    @staticmethod
    def _representation_name(image: Any, index: int) -> str:
        supported = (
            "sphericalRepresentation",
            "pinholeRepresentation",
            "cylindricalRepresentation",
            "visualReferenceRepresentation",
        )
        names = _defined_names(image, supported)
        if names != ["pinholeRepresentation"]:
            raise ValueError(
                f"Image2D {index} representations differ from the strict profile: {names}"
            )
        return names[0]

    @staticmethod
    def _blob_name(representation: Any, index: int) -> str:
        names = _defined_names(representation, ("jpegImage", "pngImage"))
        if names != ["jpegImage"]:
            raise ValueError(f"Image2D {index} blobs differ from the strict profile: {names}")
        return names[0]

    def close(self) -> None:
        self._capture.close()


def open_pye57_source(path: Path, profile: EvidenceProfile) -> EvidenceSource:
    return Pye57EvidenceSource(path, profile)


def _write_source_images(
    temporary: Path,
    source: EvidenceSource,
    guids: list[str],
    profile: EvidenceProfile,
) -> list[Image2DRecord]:
    by_guid = {guid: index for index, guid in enumerate(guids)}
    records: list[Image2DRecord] = []
    for image in source.iter_images():
        if len(records) >= profile.image2d_count:
            raise ValueError("E57 yielded more Image2D records than the strict profile")
        records.append(
            write_image_record(temporary, image, by_guid, profile, decode_jpeg_with_pillow)
        )
    validate_record_set(records, guids, profile)
    return records


def _derive_source_manifest(
    source: EvidenceSource,
    identity: CaptureIdentity,
    profile: EvidenceProfile,
) -> dict[str, Any]:
    guids = source.data3d_guids()
    validate_data3d_guids(guids, profile)
    by_guid = {guid: index for index, guid in enumerate(guids)}
    records: list[Image2DRecord] = []
    for image in source.iter_images():
        if len(records) >= profile.image2d_count:
            raise ValueError("E57 yielded more Image2D records than the strict profile")
        records.append(
            build_image_record(image, by_guid, profile, decode_jpeg_with_pillow)
        )
    validate_record_set(records, guids, profile)
    return build_manifest(identity, guids, records, profile)


def _finish_publication(
    temporary: Path,
    identity: CaptureIdentity,
    guids: list[str],
    records: list[Image2DRecord],
    profile: EvidenceProfile,
) -> dict[str, Any]:
    manifest = build_manifest(identity, guids, records, profile)
    manifest_size, manifest_sha256 = write_manifest(temporary, manifest)
    receipt = build_receipt(identity, manifest_size, manifest_sha256, records)
    write_receipt_last(temporary, receipt)
    return verify_evidence_pack(temporary, identity, profile, decode_jpeg_with_pillow)


def run_extract(
    stage_root: Path,
    output_path: Path,
    profile: EvidenceProfile = GRAND_HALL_PROFILE,
    source_factory: SourceFactory = open_pye57_source,
) -> dict[str, Any]:
    stage = load_stage(stage_root)
    output = assert_disjoint_output(output_path, [stage.root])
    _require_safe_profile_output(output, profile)
    identity = _capture_identity(stage)
    validate_capture_identity(identity, profile)
    stable_source = _verify_source_before(stage)
    source = source_factory(stage.primary_e57.path, profile)
    closed = False
    try:
        guids = source.data3d_guids()
        validate_data3d_guids(guids, profile)
        with publication_stage(output) as temporary:
            records = _write_source_images(temporary, source, guids, profile)
            source.close()
            closed = True
            _verify_source_after(stage, stable_source)
            manifest = _finish_publication(temporary, identity, guids, records, profile)
        return manifest
    finally:
        if not closed:
            source.close()


def run_check(
    stage_root: Path,
    output_path: Path,
    profile: EvidenceProfile = GRAND_HALL_PROFILE,
    source_factory: SourceFactory = open_pye57_source,
) -> dict[str, Any]:
    stage = load_stage(stage_root)
    output = assert_disjoint_output(output_path, [stage.root])
    _require_safe_profile_output(output, profile)
    identity = _capture_identity(stage)
    validate_capture_identity(identity, profile)
    stable_source = _verify_source_before(stage)
    source = source_factory(stage.primary_e57.path, profile)
    try:
        expected_manifest = _derive_source_manifest(source, identity, profile)
    finally:
        source.close()
    _verify_source_after(stage, stable_source)
    manifest = verify_evidence_pack(
        output,
        identity,
        profile,
        decode_jpeg_with_pillow,
    )
    if manifest != expected_manifest:
        raise ValueError("evidence manifest does not match exact staged E57 Image2D records")
    return manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract or check byte-exact native E57 Image2D evidence."
    )
    parser.add_argument("--stage", required=True, help="verified capture stage root")
    parser.add_argument("--out", required=True, help="disjoint evidence output root")
    parser.add_argument("--check", action="store_true", help="strictly verify an existing pack")
    parser.add_argument(
        "--verify-source-hash",
        action="store_true",
        help="mandatory acknowledgement of the two full staged-E57 hashes",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if not args.verify_source_hash:
        parser.error("--verify-source-hash is mandatory for extraction and check mode")
    operation = run_check if args.check else run_extract
    manifest = operation(Path(args.stage), Path(args.out))
    summary = manifest["summary"]
    print(
        "E57 Image2D evidence verified: "
        f"{summary['data3DCount']} scans, {summary['image2DCount']} exact JPEGs, "
        f"{summary['extractedBlobBytes']} bytes."
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"E57 Image2D evidence failed: {error}", file=sys.stderr)
        sys.exit(1)
