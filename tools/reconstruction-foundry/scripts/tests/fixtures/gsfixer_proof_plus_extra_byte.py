"""Hostile fixture that writes the expected proof plus one forbidden byte."""

from __future__ import annotations

import os


descriptor = int(os.environ["VENVIEWER_GSFIXER_COMPLETION_FD"])
nonce = bytes.fromhex(os.environ["VENVIEWER_GSFIXER_COMPLETION_NONCE"])
tag = int(os.environ["VENVIEWER_GSFIXER_COMPLETION_TAG"])
os.write(descriptor, b"VGH1" + nonce + bytes((tag,)) + b"X")
os.close(descriptor)
