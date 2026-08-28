"""Timeout fixture that creates a redirected launcher/worker process tree."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import time


def _worker(marker: Path) -> int:
    with marker.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(f"worker={os.getpid()}\n")
        stream.flush()
    while True:
        time.sleep(1)


def _launcher() -> int:
    request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    marker = Path(request["sourcePath"])
    with marker.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(f"launcher={os.getpid()}\n")
        stream.flush()
    worker = subprocess.Popen(
        [
            sys.executable,
            "-I",
            "-B",
            os.fspath(Path(__file__)),
            "--worker",
            os.fspath(marker),
        ],
        stdin=subprocess.DEVNULL,
        shell=False,
        close_fds=True,
    )
    return worker.wait()


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        return _worker(Path(sys.argv[2]))
    if len(sys.argv) != 1:
        return 2
    return _launcher()


if __name__ == "__main__":
    raise SystemExit(main())
