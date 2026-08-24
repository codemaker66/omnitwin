"""Create a genuine tiny ASTM E57 fixture for local integration tests."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import numpy as np
import pye57


def main(argv: list[str]) -> int:
    accepted_modes = {"--multi-scan", "--batch-boundary"}
    if len(argv) not in (2, 3) or (
        len(argv) == 3 and argv[2] not in accepted_modes
    ):
        raise ValueError(
            "expected one output path and optional --multi-scan or --batch-boundary"
        )
    mode = argv[2] if len(argv) == 3 else None
    output = Path(argv[1]).resolve(strict=False)
    if output.exists():
        raise ValueError("refusing to replace an existing fixture")
    output.parent.mkdir(parents=True, exist_ok=True)
    capture = pye57.E57(str(output), mode="w")
    try:
        if mode == "--batch-boundary":
            point_count = 65_537
            scan = {
                "cartesianX": np.arange(point_count, dtype=np.float32),
                "cartesianY": np.zeros(point_count, dtype=np.float32),
                "cartesianZ": np.zeros(point_count, dtype=np.float32),
                "cartesianInvalidState": np.zeros(point_count, dtype=np.int8),
            }
            name = "Venviewer genuine fixed-batch boundary E57 fixture"
            translation = np.asarray([0.0, 0.0, 0.0], dtype=np.float64)
        else:
            scan = {
                "cartesianX": np.asarray(
                    [-2.0, 0.0, 1.0, 2.0, 100.0], dtype=np.float32
                ),
                "cartesianY": np.asarray(
                    [0.0, 1.0, 2.0, 3.0, 100.0], dtype=np.float32
                ),
                "cartesianZ": np.asarray(
                    [0.0, 1.0, 2.0, 3.0, 100.0], dtype=np.float32
                ),
                "cartesianInvalidState": np.asarray(
                    [0, 0, 1, 0, 0], dtype=np.int8
                ),
            }
            name = "Venviewer genuine tiny E57 fixture"
            translation = np.asarray([10.0, 20.0, 30.0], dtype=np.float64)
        capture.write_scan_raw(
            scan,
            name=name,
            rotation=np.asarray([1.0, 0.0, 0.0, 0.0], dtype=np.float64),
            translation=translation,
        )
        if mode == "--multi-scan":
            capture.write_scan_raw(
                {
                    "cartesianX": np.asarray([1.0, 2.0, 3.0], dtype=np.float32),
                    "cartesianY": np.asarray([4.0, 5.0, 6.0], dtype=np.float32),
                    "cartesianZ": np.asarray([7.0, 8.0, 9.0], dtype=np.float32),
                    "cartesianInvalidState": np.asarray([0, 0, 0], dtype=np.int8),
                },
                name="Venviewer genuine tiny E57 fixture scan two",
                rotation=np.asarray([1.0, 0.0, 0.0, 0.0], dtype=np.float64),
                translation=np.asarray([-1.0, -2.0, -3.0], dtype=np.float64),
            )
    finally:
        capture.close()
    with output.open("rb") as stream:
        if stream.read(8) != b"ASTM-E57":
            raise ValueError("pye57 did not emit an ASTM E57 physical signature")
    sys.stdout.write(
        json.dumps(
            {"path": str(output), "sizeBytes": output.stat().st_size},
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
