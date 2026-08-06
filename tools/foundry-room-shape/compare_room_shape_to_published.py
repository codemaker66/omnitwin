#!/usr/bin/env python3
"""Compare a frozen room-shape proposal against externally published figures.

This is the **only** module in the lane that knows what anyone has published
about these rooms, and it is deliberately downstream of everything: it reads a
finished, digest-bound proposal file and prints a delta.  It does not import
the measurement module and the measurement module does not import it, so a
published figure has no path by which to reach an estimator.

The printed form is always honest -- the measurement is quoted at its own
precision with its own uncertainty and the delta is stated plainly.  A
measurement is never rounded toward a convenient number.

Usage:
    py -3.12 compare_room_shape_to_published.py PROPOSAL.json --room grand_hall
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

# Externally published venue figures, as advertised by the venue.  These are
# marketing copy, not survey data, and they are treated here strictly as a
# check on a finished measurement.
PUBLISHED_DIMENSIONS_M: dict[str, tuple[float, float, float]] = {
    "grand_hall": (21.0, 10.0, 7.0),
    "saloon": (12.0, 7.0, 5.4),
    "reception_room": (13.4, 11.2, 3.2),
    "robert_adam_room": (9.7, 5.6, 2.18),
}

DIMENSION_LABELS = ("length", "width", "height")
PROPOSAL_KEYS = ("longAxisM", "shortAxisM", "heightM")
PROPOSAL_SCHEMA_VERSION = "omnitwin.foundry.room-shape-proposal.v0"
PROPOSAL_DIGEST_DOMAIN = b"OMNITWIN_FOUNDRY_ROOM_SHAPE_PROPOSAL_V0\0"


def verify_proposal(proposal: dict[str, Any]) -> None:
    """Fail closed before comparing a frozen proposal with outside figures."""
    if proposal.get("schemaVersion") != PROPOSAL_SCHEMA_VERSION:
        raise SystemExit("proposal schema version is not supported")
    if proposal.get("authority") != "none":
        raise SystemExit("proposal must remain authority-none")
    claimed = proposal.get("proposalSha256")
    if not isinstance(claimed, str) or len(claimed) != 64:
        raise SystemExit("proposal has no valid proposalSha256")
    payload = dict(proposal)
    del payload["proposalSha256"]
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        ensure_ascii=True,
    )
    actual = hashlib.sha256(
        PROPOSAL_DIGEST_DOMAIN + canonical.encode("utf-8")
    ).hexdigest()
    if actual != claimed:
        raise SystemExit("proposal digest does not match its payload")


def format_comparison(
    *,
    label: str,
    measured_m: float,
    uncertainty_m: float,
    published_m: float,
) -> str:
    """One honest line: the measurement, its uncertainty, and the delta."""
    delta = measured_m - published_m
    return (
        f"{label}: measured {measured_m:.3f} +/- {uncertainty_m:.3f} m, "
        f"advertised {published_m:g} m, delta {delta:+.3f} m"
    )


def compare(proposal: dict[str, Any], room: str) -> list[str]:
    verify_proposal(proposal)
    if room not in PUBLISHED_DIMENSIONS_M:
        raise SystemExit(f"no advertised figures on file for room '{room}'")
    measurement = proposal.get("measurement")
    if not isinstance(measurement, dict):
        raise SystemExit("proposal has no measurement block")

    lines: list[str] = [
        f"proposal {proposal.get('proposalSha256', '(undigested)')}",
        f"state    {measurement.get('state', 'unknown')}",
    ]
    refusals = proposal.get("refusals") or []
    if refusals:
        lines.append(f"refusals {', '.join(str(item) for item in refusals)}")

    if measurement.get("state") != "measured":
        lines.append(
            "dimensions: not compared -- the proposal refused a complete measurement"
        )
        return lines

    for label, key, published in zip(
        DIMENSION_LABELS, PROPOSAL_KEYS, PUBLISHED_DIMENSIONS_M[room]
    ):
        entry = measurement.get(key)
        if not isinstance(entry, dict):
            lines.append(f"{label}: not measured -- no comparison is made")
            continue
        lines.append(
            format_comparison(
                label=label,
                measured_m=float(entry["centreM"]),
                uncertainty_m=float(entry["uncertaintyM"]),
                published_m=float(published),
            )
        )
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("proposal", type=Path, help="path to a proposal JSON file")
    parser.add_argument(
        "--room",
        required=True,
        choices=sorted(PUBLISHED_DIMENSIONS_M),
        help="which venue room's advertised figures to check against",
    )
    args = parser.parse_args(argv)
    proposal = json.loads(args.proposal.read_text(encoding="utf-8"))
    for line in compare(proposal, args.room):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
