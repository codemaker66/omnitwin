"""Extract one embedded E57 Image2D into a disjoint candidate evidence pack."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any

import pye57

from e57_stage_guard import (
    assert_disjoint_output,
    load_stage,
    sha256_file,
    verify_stage_file,
)


PROBE_SCHEMA_VERSION = "venviewer.e57-image2d-probe.v1"


def _children(node: Any) -> list[str]:
    return [node[index].elementName() for index in range(node.childCount())]


def _blob_bytes(blob: Any) -> bytes:
    buffer = bytearray(blob.byteCount())
    blob.read(buffer, 0, len(buffer))
    return bytes(buffer)


def _validate_image(content: bytes, extension: str) -> None:
    if extension == "jpg" and not (content.startswith(b"\xff\xd8") and content.endswith(b"\xff\xd9")):
        raise ValueError("embedded JPEG does not have valid SOI/EOI markers")
    if extension == "png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("embedded PNG does not have a valid signature")


def _write_file(path: Path, content: bytes) -> None:
    with path.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def _write_json(path: Path, value: Any) -> None:
    content = json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True, help="verified capture stage root")
    parser.add_argument("--out", required=True, help="new output directory outside the stage")
    parser.add_argument("--image-index", type=int, default=0)
    parser.add_argument("--verify-source-hash", action="store_true")
    args = parser.parse_args(argv)

    stage = load_stage(Path(args.stage))
    output = assert_disjoint_output(Path(args.out), [stage.root])
    if output.exists():
        raise ValueError(f"refusing to replace an existing probe artifact: {output}")
    if args.image_index < 0:
        raise ValueError("--image-index must be non-negative")
    if args.verify_source_hash:
        verify_stage_file(stage.primary_e57)

    capture = pye57.E57(str(stage.primary_e57.path))
    root = capture.image_file.root()
    if not root.isDefined("images2D"):
        raise ValueError("staged E57 has no images2D section")
    images = root["images2D"]
    if args.image_index >= images.childCount():
        raise ValueError(
            f"--image-index {args.image_index} is outside 0..{images.childCount() - 1}"
        )
    image = images[args.image_index]
    representations = [
        name
        for name in (
            "sphericalRepresentation",
            "pinholeRepresentation",
            "cylindricalRepresentation",
            "visualReferenceRepresentation",
        )
        if image.isDefined(name)
    ]
    if len(representations) != 1:
        raise ValueError(
            f"Image2D must contain exactly one supported representation, found {representations}"
        )
    representation_name = representations[0]
    representation = image[representation_name]
    blobs = [
        (name, "jpg" if name == "jpegImage" else "png")
        for name in ("jpegImage", "pngImage")
        if representation.isDefined(name)
    ]
    if len(blobs) != 1:
        raise ValueError(f"Image2D representation must contain exactly one JPEG or PNG blob, found {blobs}")
    blob_name, extension = blobs[0]
    content = _blob_bytes(representation[blob_name])
    _validate_image(content, extension)

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.stage-", dir=output.parent))
    try:
        image_name = f"image2d_{args.image_index:03d}.{extension}"
        image_path = temporary / image_name
        _write_file(image_path, content)
        report = {
            "schemaVersion": PROBE_SCHEMA_VERSION,
            "captureStagePlanSha256": stage.plan_sha256,
            "sourceE57Sha256": stage.primary_e57.sha256,
            "sourceHashVerifiedThisRun": bool(args.verify_source_hash),
            "imageIndex": args.image_index,
            "imageCount": images.childCount(),
            "imageChildren": _children(image),
            "representation": representation_name,
            "representationChildren": _children(representation),
            "associatedData3DGuid": (
                str(image["associatedData3DGuid"].value())
                if image.isDefined("associatedData3DGuid")
                else None
            ),
            "width": (
                int(representation["imageWidth"].value())
                if representation.isDefined("imageWidth")
                else None
            ),
            "height": (
                int(representation["imageHeight"].value())
                if representation.isDefined("imageHeight")
                else None
            ),
            "artifact": {
                "relativePath": image_name,
                "sizeBytes": len(content),
                "sha256": sha256_file(image_path),
            },
            "promotionStatus": "candidate_only",
            "limitation": "One embedded photo proves neither panorama orientation nor room-shell geometry authority.",
        }
        _write_json(temporary / "probe-evidence.json", report)
        os.replace(temporary, output)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    print(
        f"Image2D probe complete: index {args.image_index}, {len(content)} bytes, output {output}"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"Image2D probe failed: {error}", file=sys.stderr)
        sys.exit(1)
