"""Verify a private Reception Room E57 visual-retrieval bundle."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

from retrieve_e57_reference_views import RetrievalError, verify_retrieval_bundle


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verify every bound file in an authority-none E57 visual shortlist bundle."
        )
    )
    parser.add_argument("--bundle", required=True, type=Path)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        result = verify_retrieval_bundle(args.bundle)
    except (RetrievalError, FileNotFoundError, NotADirectoryError, OSError) as error:
        parser.exit(2, f"error: {error}\n")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
