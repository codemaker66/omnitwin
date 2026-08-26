"""Strict, authority-none evidence helpers for native E57 Image2D JPEGs.

The core deliberately knows nothing about pye57. A boundary adapter supplies
Data3D GUIDs and one Image2D blob at a time; this module validates, writes and
re-verifies byte-exact evidence without inventing camera or room authority.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, dataclass
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
from typing import Any, Callable, Iterator, Sequence


MANIFEST_SCHEMA_VERSION = "venviewer.e57-image2d-evidence.v1"
RECEIPT_SCHEMA_VERSION = "venviewer.e57-image2d-evidence-publication.v1"
MANIFEST_NAME = "image2d-inventory-authority-none.json"
RECEIPT_NAME = "publication-receipt.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SKYBOX_NAME_RE = re.compile(r"^Skybox (0|[1-9][0-9]*)$")
GRAND_HALL_E57_SHA256 = (
    "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd"
)
GRAND_HALL_E57_SIZE_BYTES = 20_518_437_888
GRAND_HALL_IMAGE2D_BYTES = 2_927_438_001


@dataclass(frozen=True)
class EvidenceProfile:
    expected_e57_sha256: str
    expected_e57_size_bytes: int
    data3d_count: int
    image2d_count: int
    faces_per_data3d: int
    width: int
    height: int
    expected_aggregate_bytes: int
    maximum_blob_bytes: int = 32 * 1024 * 1024
    maximum_aggregate_bytes: int = 8 * 1024 * 1024 * 1024


GRAND_HALL_PROFILE = EvidenceProfile(
    expected_e57_sha256=GRAND_HALL_E57_SHA256,
    expected_e57_size_bytes=GRAND_HALL_E57_SIZE_BYTES,
    data3d_count=149,
    image2d_count=894,
    faces_per_data3d=6,
    width=4096,
    height=4096,
    expected_aggregate_bytes=GRAND_HALL_IMAGE2D_BYTES,
)


@dataclass(frozen=True)
class CaptureIdentity:
    capture_stage_plan_sha256: str
    e57_target_relative_path: str
    e57_size_bytes: int
    e57_sha256: str


@dataclass(frozen=True)
class DecodedJpeg:
    width: int
    height: int
    mode: str
    format: str


@dataclass(frozen=True)
class FileSnapshot:
    device: int
    inode: int
    mode: int
    size_bytes: int
    modified_ns: int
    changed_ns: int


@dataclass(frozen=True)
class Image2DInput:
    image_index: int
    image_guid: str
    image_name: str
    associated_data3d_guid: str
    representation_name: str
    blob_name: str
    width: int
    height: int
    focal_length: float
    pixel_width: float
    pixel_height: float
    principal_point_x: float
    principal_point_y: float
    jpeg_bytes: bytes


@dataclass(frozen=True)
class Image2DRecord:
    imageIndex: int
    imageGuid: str
    imageName: str
    faceIndex: int
    associatedData3DGuid: str
    data3DIndex: int
    representation: str
    blob: str
    width: int
    height: int
    focalLength: float
    pixelWidth: float
    pixelHeight: float
    principalPointX: float
    principalPointY: float
    decodedMode: str
    relativePath: str
    sizeBytes: int
    sha256: str


JpegDecoder = Callable[[bytes], DecodedJpeg]


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json_bytes(value: Any) -> bytes:
    text = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        indent=2,
        sort_keys=True,
    )
    return (text + "\n").encode("utf-8")


def _require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual == expected:
        return
    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    raise ValueError(f"{label} keys differ; missing={missing}, unexpected={unexpected}")


def _require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    return value


def _require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _require_sha256(value: Any, label: str) -> str:
    text = _require_string(value, label)
    if SHA256_RE.fullmatch(text) is None:
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return text


def _require_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _require_finite(value: Any, label: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a finite number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    return number


def _reject_constant(value: str) -> None:
    raise ValueError(f"JSON constant is not permitted: {value}")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _exact_json_value(actual: Any, expected: Any) -> bool:
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        if set(actual) != set(expected):
            return False
        return all(_exact_json_value(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        if len(actual) != len(expected):
            return False
        return all(_exact_json_value(left, right) for left, right in zip(actual, expected))
    return bool(actual == expected)


def load_canonical_json(path: Path, label: str) -> dict[str, Any]:
    try:
        content = path.read_bytes()
        value = json.loads(
            content.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not strict UTF-8 JSON") from error
    result = _require_dict(value, label)
    if content != canonical_json_bytes(result):
        raise ValueError(f"{label} is not in canonical evidence JSON form")
    return result


def _require_relative_path(value: Any, label: str) -> str:
    text = _require_string(value, label)
    if "\\" in text:
        raise ValueError(f"{label} must use forward slashes")
    pure = PurePosixPath(text)
    invalid = pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts)
    if invalid or not pure.parts:
        raise ValueError(f"{label} must be a canonical relative path")
    return text


def validate_profile(profile: EvidenceProfile) -> None:
    _require_sha256(profile.expected_e57_sha256, "profile E57 SHA-256")
    positive = (
        profile.expected_e57_size_bytes,
        profile.data3d_count,
        profile.image2d_count,
        profile.faces_per_data3d,
        profile.width,
        profile.height,
        profile.expected_aggregate_bytes,
        profile.maximum_blob_bytes,
        profile.maximum_aggregate_bytes,
    )
    if any(value <= 0 for value in positive):
        raise ValueError("evidence profile counts, dimensions and bounds must be positive")
    if profile.image2d_count != profile.data3d_count * profile.faces_per_data3d:
        raise ValueError("evidence profile image count must equal scans times faces")
    if profile.expected_aggregate_bytes > profile.maximum_aggregate_bytes:
        raise ValueError("expected aggregate bytes exceed the evidence bound")


def validate_capture_identity(identity: CaptureIdentity, profile: EvidenceProfile) -> None:
    validate_profile(profile)
    _require_sha256(identity.capture_stage_plan_sha256, "capture stage plan SHA-256")
    _require_relative_path(identity.e57_target_relative_path, "E57 target relative path")
    _require_sha256(identity.e57_sha256, "E57 SHA-256")
    if identity.e57_sha256 != profile.expected_e57_sha256:
        raise ValueError("capture stage cites the wrong E57 SHA-256")
    if identity.e57_size_bytes != profile.expected_e57_size_bytes:
        raise ValueError("capture stage cites the wrong E57 byte count")


def validate_data3d_guids(guids: Sequence[str], profile: EvidenceProfile) -> None:
    if len(guids) != profile.data3d_count:
        raise ValueError(f"expected {profile.data3d_count} Data3D GUIDs, found {len(guids)}")
    if any(not isinstance(guid, str) or not guid for guid in guids):
        raise ValueError("Data3D GUIDs must be non-empty strings")
    if len(set(guids)) != len(guids):
        raise ValueError("Data3D GUIDs must be unique")


def _face_index(image_name: str, profile: EvidenceProfile) -> int:
    match = SKYBOX_NAME_RE.fullmatch(image_name)
    if match is None:
        raise ValueError(f"unexpected Image2D name: {image_name!r}")
    face_index = int(match.group(1))
    if face_index >= profile.faces_per_data3d:
        raise ValueError(f"Image2D face index is outside the profile: {face_index}")
    return face_index


def _validate_intrinsics(image: Image2DInput) -> None:
    focal = _require_finite(image.focal_length, "Image2D focal length")
    pixel_width = _require_finite(image.pixel_width, "Image2D pixel width")
    pixel_height = _require_finite(image.pixel_height, "Image2D pixel height")
    principal_x = _require_finite(image.principal_point_x, "Image2D principal point X")
    principal_y = _require_finite(image.principal_point_y, "Image2D principal point Y")
    if focal <= 0 or pixel_width <= 0 or pixel_height <= 0:
        raise ValueError("Image2D focal length and pixel dimensions must be positive")
    if not 0 <= principal_x < image.width or not 0 <= principal_y < image.height:
        raise ValueError("Image2D principal point must lie within the image bounds")


def _validate_image_input(image: Image2DInput, profile: EvidenceProfile) -> int:
    valid_index = isinstance(image.image_index, int) and not isinstance(image.image_index, bool)
    valid_guids = isinstance(image.image_guid, str) and isinstance(
        image.associated_data3d_guid, str
    )
    if not valid_index or image.image_index < 0 or not valid_guids:
        raise ValueError("Image2D index and GUID bindings must have exact scalar types")
    if not image.image_guid or not image.associated_data3d_guid:
        raise ValueError("Image2D index and GUID bindings must be present")
    if image.representation_name != "pinholeRepresentation":
        raise ValueError("Image2D must use exactly pinholeRepresentation")
    if image.blob_name != "jpegImage":
        raise ValueError("Image2D must use exactly one jpegImage blob")
    if image.width != profile.width or image.height != profile.height:
        raise ValueError("Image2D dimensions differ from the evidence profile")
    if not isinstance(image.jpeg_bytes, bytes):
        raise ValueError("Image2D JPEG blob must be immutable bytes")
    if not 4 <= len(image.jpeg_bytes) <= profile.maximum_blob_bytes:
        raise ValueError("Image2D JPEG blob exceeds the evidence bounds")
    _validate_intrinsics(image)
    return _face_index(image.image_name, profile)


def validate_jpeg(content: bytes, profile: EvidenceProfile, decoder: JpegDecoder) -> DecodedJpeg:
    if not content.startswith(b"\xff\xd8") or not content.endswith(b"\xff\xd9"):
        raise ValueError("Image2D JPEG lacks exact SOI/EOI markers")
    try:
        decoded = decoder(content)
    except Exception as error:
        raise ValueError("Image2D JPEG failed a full decode") from error
    if decoded.format != "JPEG":
        raise ValueError(f"Image2D blob decoded as {decoded.format!r}, not JPEG")
    if decoded.width != profile.width or decoded.height != profile.height:
        raise ValueError("decoded Image2D dimensions differ from the evidence profile")
    if not decoded.mode:
        raise ValueError("decoded Image2D mode must be recorded")
    return decoded


def image_relative_path(data3d_index: int, image_index: int, face_index: int) -> str:
    return (
        f"images/scan_{data3d_index:03d}/"
        f"image2d_{image_index:03d}_skybox_{face_index}.jpg"
    )


def _write_exclusive(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def build_image_record(
    image: Image2DInput,
    data3d_by_guid: dict[str, int],
    profile: EvidenceProfile,
    decoder: JpegDecoder,
) -> Image2DRecord:
    face_index = _validate_image_input(image, profile)
    if image.associated_data3d_guid not in data3d_by_guid:
        raise ValueError("Image2D associatedData3DGuid does not bind an exact Data3D GUID")
    decoded = validate_jpeg(image.jpeg_bytes, profile, decoder)
    data3d_index = data3d_by_guid[image.associated_data3d_guid]
    relative_path = image_relative_path(data3d_index, image.image_index, face_index)
    return Image2DRecord(
        imageIndex=image.image_index,
        imageGuid=image.image_guid,
        imageName=image.image_name,
        faceIndex=face_index,
        associatedData3DGuid=image.associated_data3d_guid,
        data3DIndex=data3d_index,
        representation=image.representation_name,
        blob=image.blob_name,
        width=image.width,
        height=image.height,
        focalLength=image.focal_length,
        pixelWidth=image.pixel_width,
        pixelHeight=image.pixel_height,
        principalPointX=image.principal_point_x,
        principalPointY=image.principal_point_y,
        decodedMode=decoded.mode,
        relativePath=relative_path,
        sizeBytes=len(image.jpeg_bytes),
        sha256=sha256_bytes(image.jpeg_bytes),
    )


def write_image_record(
    root: Path,
    image: Image2DInput,
    data3d_by_guid: dict[str, int],
    profile: EvidenceProfile,
    decoder: JpegDecoder,
) -> Image2DRecord:
    record = build_image_record(image, data3d_by_guid, profile, decoder)
    _write_exclusive(root / PurePosixPath(record.relativePath), image.jpeg_bytes)
    return record


def _validate_faces_by_scan(
    records: Sequence[Image2DRecord],
    data3d_guids: Sequence[str],
    profile: EvidenceProfile,
) -> None:
    expected_faces = set(range(profile.faces_per_data3d))
    grouped: dict[int, list[Image2DRecord]] = {index: [] for index in range(len(data3d_guids))}
    for record in records:
        if record.data3DIndex not in grouped:
            raise ValueError("Image2D record cites an unknown Data3D index")
        if record.associatedData3DGuid != data3d_guids[record.data3DIndex]:
            raise ValueError("Image2D record drifted from its exact Data3D GUID binding")
        grouped[record.data3DIndex].append(record)
    for scan_index, group in grouped.items():
        faces = {record.faceIndex for record in group}
        if faces != expected_faces or len(group) != len(expected_faces):
            raise ValueError(f"Data3D scan {scan_index} lacks exactly every Skybox face")


def _validate_record_contract(record: Image2DRecord, profile: EvidenceProfile) -> None:
    if record.representation != "pinholeRepresentation" or record.blob != "jpegImage":
        raise ValueError("Image2D record representation or blob contract drifted")
    if record.width != profile.width or record.height != profile.height:
        raise ValueError("Image2D record dimensions differ from the evidence profile")
    if not 4 <= record.sizeBytes <= profile.maximum_blob_bytes:
        raise ValueError("Image2D record byte count exceeds the evidence bounds")
    if _face_index(record.imageName, profile) != record.faceIndex:
        raise ValueError("Image2D name and face index disagree")
    if record.relativePath != image_relative_path(
        record.data3DIndex, record.imageIndex, record.faceIndex
    ):
        raise ValueError("Image2D record path is not canonical for its exact indices")
    _require_string(record.imageGuid, "Image2D record GUID")
    _require_string(record.associatedData3DGuid, "Image2D associated Data3D GUID")
    _require_string(record.decodedMode, "Image2D decoded mode")
    _require_sha256(record.sha256, "Image2D record SHA-256")
    _validate_record_intrinsics(record)


def _validate_record_intrinsics(record: Image2DRecord) -> None:
    focal = _require_finite(record.focalLength, "Image2D record focal length")
    pixel_width = _require_finite(record.pixelWidth, "Image2D record pixel width")
    pixel_height = _require_finite(record.pixelHeight, "Image2D record pixel height")
    principal_x = _require_finite(record.principalPointX, "Image2D record principal point X")
    principal_y = _require_finite(record.principalPointY, "Image2D record principal point Y")
    if focal <= 0 or pixel_width <= 0 or pixel_height <= 0:
        raise ValueError("Image2D record focal length and pixel dimensions must be positive")
    if not 0 <= principal_x < record.width or not 0 <= principal_y < record.height:
        raise ValueError("Image2D record principal point lies outside the image bounds")


def validate_record_set(
    records: Sequence[Image2DRecord],
    data3d_guids: Sequence[str],
    profile: EvidenceProfile,
) -> None:
    validate_profile(profile)
    validate_data3d_guids(data3d_guids, profile)
    if len(records) != profile.image2d_count:
        raise ValueError(f"expected {profile.image2d_count} Image2D records, found {len(records)}")
    if [record.imageIndex for record in records] != list(range(profile.image2d_count)):
        raise ValueError("Image2D records must preserve contiguous native vector order")
    if len({record.imageGuid for record in records}) != len(records):
        raise ValueError("Image2D GUIDs must be unique")
    if len({record.relativePath for record in records}) != len(records):
        raise ValueError("Image2D evidence paths must be unique")
    for record in records:
        _validate_record_contract(record, profile)
    _validate_faces_by_scan(records, data3d_guids, profile)
    aggregate_bytes = sum(record.sizeBytes for record in records)
    if aggregate_bytes != profile.expected_aggregate_bytes:
        raise ValueError("Image2D aggregate JPEG bytes differ from the exact profile")
    if aggregate_bytes > profile.maximum_aggregate_bytes:
        raise ValueError("Image2D aggregate JPEG bytes exceed the evidence bound")


def _source_manifest(identity: CaptureIdentity) -> dict[str, Any]:
    return {
        "captureStagePlanSha256": identity.capture_stage_plan_sha256,
        "e57Sha256": identity.e57_sha256,
        "e57SizeBytes": identity.e57_size_bytes,
        "e57TargetRelativePath": identity.e57_target_relative_path,
        "sourceHashVerifiedAfterExtraction": True,
        "sourceHashVerifiedBeforeExtraction": True,
    }


def _authority_contract() -> dict[str, Any]:
    return {
        "associationMethod": "exact_associatedData3DGuid",
        "blobDisposition": "byte_exact_no_decode_reencode",
        "cameraOrientationAuthority": "none",
        "collisionAuthority": False,
        "exportAuthority": False,
        "generatedContent": False,
        "panoramaCorrespondenceAuthority": "none",
        "publicAuthority": False,
        "reconstructionAuthority": False,
        "roomMembershipAuthority": "none",
        "runtimeAuthority": False,
        "sourceMutationPermitted": False,
        "storedImagePoseHandling": "not_read_not_used_no_authority",
        "structuralAuthority": False,
        "trainingAuthority": False,
    }


def build_manifest(
    identity: CaptureIdentity,
    data3d_guids: Sequence[str],
    records: Sequence[Image2DRecord],
    profile: EvidenceProfile,
) -> dict[str, Any]:
    validate_capture_identity(identity, profile)
    validate_record_set(records, data3d_guids, profile)
    return {
        "authority": "none",
        "contract": _authority_contract(),
        "data3D": [
            {"guid": guid, "scanIndex": index} for index, guid in enumerate(data3d_guids)
        ],
        "images": [asdict(record) for record in records],
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "source": _source_manifest(identity),
        "summary": {
            "data3DCount": len(data3d_guids),
            "extractedBlobBytes": sum(record.sizeBytes for record in records),
            "facesPerData3D": profile.faces_per_data3d,
            "height": profile.height,
            "image2DCount": len(records),
            "width": profile.width,
        },
    }


def write_manifest(root: Path, manifest: dict[str, Any]) -> tuple[int, str]:
    content = canonical_json_bytes(manifest)
    _write_exclusive(root / MANIFEST_NAME, content)
    return len(content), sha256_bytes(content)


def build_receipt(
    identity: CaptureIdentity,
    manifest_size: int,
    manifest_sha256: str,
    records: Sequence[Image2DRecord],
) -> dict[str, Any]:
    return {
        "authority": "none",
        "captureStagePlanSha256": identity.capture_stage_plan_sha256,
        "manifest": {
            "relativePath": MANIFEST_NAME,
            "sha256": manifest_sha256,
            "sizeBytes": manifest_size,
        },
        "payload": {
            "imageBytes": sum(record.sizeBytes for record in records),
            "imageCount": len(records),
        },
        "publicationComplete": True,
        "receiptWrittenLast": True,
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "sourceE57Sha256": identity.e57_sha256,
    }


def write_receipt_last(root: Path, receipt: dict[str, Any]) -> None:
    if not (root / MANIFEST_NAME).is_file():
        raise ValueError("publication manifest must exist before the terminal receipt")
    _write_exclusive(root / RECEIPT_NAME, canonical_json_bytes(receipt))


def _lexists(path: Path) -> bool:
    return os.path.lexists(path)


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@contextmanager
def publication_stage(output: Path) -> Iterator[Path]:
    if _lexists(output):
        raise ValueError(f"refusing to replace existing evidence output: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.stage-", dir=output.parent))
    try:
        yield temporary
        if not (temporary / RECEIPT_NAME).is_file():
            raise ValueError("terminal publication receipt was not written")
        if _lexists(output):
            raise ValueError(f"refusing to replace raced evidence output: {output}")
        os.rename(temporary, output)
        _fsync_directory(output.parent)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def _is_link_or_reparse(path: Path) -> bool:
    metadata = path.lstat()
    attributes = getattr(metadata, "st_file_attributes", 0)
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return path.is_symlink() or (reparse != 0 and bool(attributes & reparse))


def _inventory_files(root: Path) -> set[str]:
    if _is_link_or_reparse(root) or not root.is_dir():
        raise ValueError("evidence root must be a real directory")
    result: set[str] = set()
    for directory, names, files in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        for name in names:
            if _is_link_or_reparse(directory_path / name):
                raise ValueError("evidence root contains a linked or reparse directory")
        for name in files:
            path = directory_path / name
            if _is_link_or_reparse(path) or not path.is_file():
                raise ValueError("evidence root contains a linked or non-regular file")
            result.add(path.relative_to(root).as_posix())
    return result


def _snapshot_from_stat(metadata: os.stat_result) -> FileSnapshot:
    return FileSnapshot(
        device=metadata.st_dev,
        inode=metadata.st_ino,
        mode=metadata.st_mode,
        size_bytes=metadata.st_size,
        modified_ns=metadata.st_mtime_ns,
        changed_ns=metadata.st_ctime_ns,
    )


def _snapshot_regular_file(path: Path) -> FileSnapshot:
    if _is_link_or_reparse(path):
        raise ValueError(f"evidence path became a link or reparse point: {path}")
    snapshot = _snapshot_from_stat(path.lstat())
    if not stat.S_ISREG(snapshot.mode):
        raise ValueError(f"evidence path is not a regular file: {path}")
    return snapshot


def _snapshot_files(root: Path, relative_paths: set[str]) -> dict[str, FileSnapshot]:
    return {
        relative_path: _snapshot_regular_file(root / PurePosixPath(relative_path))
        for relative_path in sorted(relative_paths)
    }


def _same_open_file(actual: FileSnapshot, expected: FileSnapshot) -> bool:
    return (
        actual.device,
        actual.inode,
        actual.mode,
        actual.size_bytes,
        actual.modified_ns,
    ) == (
        expected.device,
        expected.inode,
        expected.mode,
        expected.size_bytes,
        expected.modified_ns,
    )


def _read_stable_bytes(path: Path, expected: FileSnapshot) -> bytes:
    before_path = _snapshot_regular_file(path)
    if before_path != expected:
        raise ValueError(f"evidence file changed before verification: {path}")
    with path.open("rb") as stream:
        before_handle = _snapshot_from_stat(os.fstat(stream.fileno()))
        content = stream.read()
        after_handle = _snapshot_from_stat(os.fstat(stream.fileno()))
    after_path = _snapshot_regular_file(path)
    handles_stable = _same_open_file(before_handle, expected) and _same_open_file(
        after_handle, expected
    )
    if not handles_stable or after_path != expected:
        raise ValueError(f"evidence file changed during verification: {path}")
    return content


def _parse_source(value: Any, identity: CaptureIdentity) -> None:
    source = _require_dict(value, "manifest source")
    _require_exact_keys(source, set(_source_manifest(identity)), "manifest source")
    if not _exact_json_value(source, _source_manifest(identity)):
        raise ValueError("manifest source does not bind the exact verified capture stage")


def _parse_data3d(value: Any, profile: EvidenceProfile) -> list[str]:
    entries = _require_list(value, "manifest data3D")
    guids: list[str] = []
    for index, raw in enumerate(entries):
        item = _require_dict(raw, f"manifest data3D[{index}]")
        _require_exact_keys(item, {"guid", "scanIndex"}, f"manifest data3D[{index}]")
        if _require_int(item["scanIndex"], "Data3D scanIndex") != index:
            raise ValueError("manifest Data3D records must preserve native vector order")
        guids.append(_require_string(item["guid"], "Data3D GUID"))
    validate_data3d_guids(guids, profile)
    return guids


def _validate_record_scalars(record: Image2DRecord, index: int) -> None:
    integer_fields = (record.imageIndex, record.faceIndex, record.data3DIndex)
    invalid_indices = (
        not isinstance(value, int) or isinstance(value, bool) or value < 0
        for value in integer_fields
    )
    if any(invalid_indices):
        raise ValueError(f"manifest images[{index}] indices must be non-negative integers")
    dimensions = (record.width, record.height, record.sizeBytes)
    invalid_dimensions = (
        not isinstance(value, int) or isinstance(value, bool) or value <= 0
        for value in dimensions
    )
    if any(invalid_dimensions):
        raise ValueError(f"manifest images[{index}] dimensions and bytes must be positive integers")
    for name in ("imageGuid", "imageName", "associatedData3DGuid", "decodedMode"):
        _require_string(getattr(record, name), f"manifest images[{index}].{name}")
    _require_relative_path(record.relativePath, f"manifest images[{index}].relativePath")
    _require_sha256(record.sha256, f"manifest images[{index}].sha256")
    for field in ("focalLength", "pixelWidth", "pixelHeight", "principalPointX", "principalPointY"):
        _require_finite(getattr(record, field), f"manifest images[{index}].{field}")


def _record_from_json(value: Any, index: int) -> Image2DRecord:
    item = _require_dict(value, f"manifest images[{index}]")
    expected = set(Image2DRecord.__dataclass_fields__)
    _require_exact_keys(item, expected, f"manifest images[{index}]")
    try:
        record = Image2DRecord(**item)
    except TypeError as error:
        raise ValueError(f"manifest images[{index}] has invalid fields") from error
    _validate_record_scalars(record, index)
    return record


def _parse_records(value: Any) -> list[Image2DRecord]:
    entries = _require_list(value, "manifest images")
    return [_record_from_json(raw, index) for index, raw in enumerate(entries)]


def _validate_manifest_header(
    raw: dict[str, Any],
    identity: CaptureIdentity,
    profile: EvidenceProfile,
) -> None:
    expected = {"authority", "contract", "data3D", "images", "schemaVersion", "source", "summary"}
    _require_exact_keys(raw, expected, "evidence manifest")
    if raw["schemaVersion"] != MANIFEST_SCHEMA_VERSION or raw["authority"] != "none":
        raise ValueError("unsupported or authoritative Image2D evidence manifest")
    if not _exact_json_value(raw["contract"], _authority_contract()):
        raise ValueError("manifest authority contract drifted")
    _parse_source(raw["source"], identity)
    validate_capture_identity(identity, profile)


def _validate_summary(
    value: Any,
    records: Sequence[Image2DRecord],
    profile: EvidenceProfile,
) -> None:
    summary = _require_dict(value, "manifest summary")
    expected = {
        "data3DCount", "extractedBlobBytes", "facesPerData3D", "height", "image2DCount", "width"
    }
    _require_exact_keys(summary, expected, "manifest summary")
    wanted = {
        "data3DCount": profile.data3d_count,
        "extractedBlobBytes": sum(record.sizeBytes for record in records),
        "facesPerData3D": profile.faces_per_data3d,
        "height": profile.height,
        "image2DCount": profile.image2d_count,
        "width": profile.width,
    }
    if not _exact_json_value(summary, wanted):
        raise ValueError("manifest summary does not match its exact records and profile")


def _verify_record_file(
    root: Path,
    record: Image2DRecord,
    expected_snapshot: FileSnapshot,
    profile: EvidenceProfile,
    decoder: JpegDecoder,
) -> None:
    expected_path = image_relative_path(record.data3DIndex, record.imageIndex, record.faceIndex)
    if record.relativePath != expected_path:
        raise ValueError("Image2D evidence path is not canonical for its exact indices")
    path = root / PurePosixPath(record.relativePath)
    content = _read_stable_bytes(path, expected_snapshot)
    if len(content) != record.sizeBytes or sha256_bytes(content) != record.sha256:
        raise ValueError(f"Image2D evidence bytes drifted: {record.relativePath}")
    decoded = validate_jpeg(content, profile, decoder)
    if decoded.mode != record.decodedMode:
        raise ValueError(f"Image2D decoded mode drifted: {record.relativePath}")


def _parse_receipt(root: Path, identity: CaptureIdentity, records: Sequence[Image2DRecord]) -> None:
    receipt = load_canonical_json(root / RECEIPT_NAME, "publication receipt")
    expected = {
        "authority", "captureStagePlanSha256", "manifest", "payload", "publicationComplete",
        "receiptWrittenLast", "schemaVersion", "sourceE57Sha256"
    }
    _require_exact_keys(receipt, expected, "publication receipt")
    manifest_path = root / MANIFEST_NAME
    wanted = build_receipt(
        identity,
        manifest_path.stat().st_size,
        sha256_file(manifest_path),
        records,
    )
    if not _exact_json_value(receipt, wanted):
        raise ValueError("publication receipt does not bind the exact completed evidence pack")


def verify_evidence_pack(
    root: Path,
    identity: CaptureIdentity,
    profile: EvidenceProfile,
    decoder: JpegDecoder,
) -> dict[str, Any]:
    manifest = load_canonical_json(root / MANIFEST_NAME, "Image2D evidence manifest")
    _validate_manifest_header(manifest, identity, profile)
    guids = _parse_data3d(manifest["data3D"], profile)
    records = _parse_records(manifest["images"])
    validate_record_set(records, guids, profile)
    _validate_summary(manifest["summary"], records, profile)
    expected_files = {MANIFEST_NAME, RECEIPT_NAME, *(record.relativePath for record in records)}
    if _inventory_files(root) != expected_files:
        raise ValueError("evidence root contains missing or unexpected files")
    initial_snapshots = _snapshot_files(root, expected_files)
    if load_canonical_json(root / MANIFEST_NAME, "Image2D evidence manifest") != manifest:
        raise ValueError("evidence manifest changed during verification")
    for record in records:
        _verify_record_file(root, record, initial_snapshots[record.relativePath], profile, decoder)
    _parse_receipt(root, identity, records)
    if _inventory_files(root) != expected_files:
        raise ValueError("evidence root inventory changed during verification")
    if _snapshot_files(root, expected_files) != initial_snapshots:
        raise ValueError("evidence files changed during verification")
    return manifest
