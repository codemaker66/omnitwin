"""Hostile fixture: forge the v1 proof without running the GSFixer adapter.

The production supervisor must reject these bytes before it creates a receipt
directory or exposes a completion descriptor. This file is only executed by a
negative security test against a deliberately vulnerable test build.
"""

from __future__ import annotations

import os


descriptor = int(os.environ["VENVIEWER_GSFIXER_COMPLETION_FD"])
nonce = bytes.fromhex(os.environ["VENVIEWER_GSFIXER_COMPLETION_NONCE"])
tag = int(os.environ["VENVIEWER_GSFIXER_COMPLETION_TAG"])
os.write(descriptor, b"VGH1" + nonce + bytes((tag,)))
os.close(descriptor)
