"""Deprecated cube-photo extractor.

This historical script depended on mutable derived cube faces and defaulted
writes into the capture workspace. Those inputs are outside the verified-stage
boundary, so the entry point now fails closed.
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.parse_args(argv)
    parser.error(
        "extract_photos.py is disabled because it depends on unverified derived cube faces; "
        "use the verified-stage equirect v2 workflow"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
