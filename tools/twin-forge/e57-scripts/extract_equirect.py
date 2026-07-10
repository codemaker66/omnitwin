"""Deprecated equirect v1 entry point.

The v1 algorithm trusted corrupted per-photo orientations and produced a
patchwork of upright and flipped regions. It is retained only as a fail-closed
pointer so old operator commands cannot mutate capture-source directories.
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.parse_args(argv)
    parser.error(
        "extract_equirect.py v1 is disabled because its orientation model is invalid; "
        "use extract_equirect_v2.py with --stage, --truth-panos, --truth-manifest, and a disjoint --out"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
