"""Deprecated empirical cube-photo extractor v3.

Although v3 added orientation diagnostics, its anchor and repair oracles still
depended on excluded historical cubemap and lidar-pano directories. It cannot
produce verified-stage evidence and therefore fails closed.
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.parse_args(argv)
    parser.error(
        "extract_photos_v3.py is disabled because its oracles are unverified derived assets; "
        "regenerate staged-E57 truth evidence and use extract_equirect_v2.py"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
