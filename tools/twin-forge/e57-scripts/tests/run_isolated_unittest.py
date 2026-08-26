"""Trusted test-only entry point for the isolated T560 worker modules."""

from __future__ import annotations

import sys

if not (
    sys.flags.isolated == 1
    and sys.flags.no_site == 1
    and sys.flags.no_user_site == 1
    and sys.flags.ignore_environment == 1
    and sys.flags.safe_path
    and sys.dont_write_bytecode
    and sys.pycache_prefix == "NUL"
):
    raise RuntimeError(
        "tests require Python -I -S -B -X pycache_prefix=NUL"
    )

import unittest
from pathlib import Path


SCRIPTS_ROOT = Path(__file__).resolve(strict=True).parent.parent
sys.path.insert(0, str(SCRIPTS_ROOT))

unittest.main(module=None)
