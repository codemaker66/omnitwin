"""Hostile fixture that escapes the process group and appends after a valid prefix."""

from __future__ import annotations

import os
import time


descriptor = int(os.environ["VENVIEWER_GSFIXER_COMPLETION_FD"])
nonce = bytes.fromhex(os.environ["VENVIEWER_GSFIXER_COMPLETION_NONCE"])
tag = int(os.environ["VENVIEWER_GSFIXER_COMPLETION_TAG"])
child = os.fork()
if child == 0:
    os.setsid()
    time.sleep(0.25)
    os.write(descriptor, b"X")
    os.close(descriptor)
    os._exit(0)

os.write(descriptor, b"VGH1" + nonce + bytes((tag,)))
os._exit(0)
