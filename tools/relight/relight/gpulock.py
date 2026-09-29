"""The build PC's shared GPU lock (one GPU-heavy job at a time)."""
from __future__ import annotations

import contextlib, datetime, json, os, time

LOCK = "D:/claude/visual-firstprinciples-20260928/gpu.lock"


@contextlib.contextmanager
def hold(owner: str, poll_s: float = 5.0):
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            time.sleep(poll_s)
    record = {"owner": owner, "since": datetime.datetime.now().astimezone().isoformat()}
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(record, f)
    try:
        yield
    finally:
        _release(record)


def _release(record: dict) -> None:
    """Remove the lock only while it still holds our own record: another session's lock is never deleted."""
    try:
        with open(LOCK, encoding="utf-8") as f:
            held = json.load(f)
    except (FileNotFoundError, ValueError):     # already gone, or another holder's (non-JSON) record
        return
    if isinstance(held, dict) and held.get("owner") == record["owner"] and held.get("since") == record["since"]:
        os.remove(LOCK)
