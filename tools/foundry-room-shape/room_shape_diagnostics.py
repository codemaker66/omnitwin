#!/usr/bin/env python3
"""Deterministic, review-only diagrams for a room-shape proposal.

The diagram is deliberately downstream of measurement.  It does not choose a
wall, change a threshold or read an outside dimension.  A fixed-stride sample
of the measured cloud supplies context; every enumerated wall candidate and
scanner origin is overlaid in the recovered room frame.
"""

from __future__ import annotations

import html
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

import room_shape

SVG_WIDTH = 1200
SVG_HEIGHT = 900
PLOT_LEFT = 70
PLOT_TOP = 150
PLOT_RIGHT = 1130
PLOT_BOTTOM = 840
MAX_CONTEXT_POINTS = 25_000


def _fmt(value: float) -> str:
    return f"{float(value):.3f}"


def _bounds(
    candidates: tuple[room_shape.Candidate, ...],
    origins: np.ndarray,
) -> tuple[float, float, float, float]:
    xs = [float(origins[:, 0].min()), float(origins[:, 0].max())]
    ys = [float(origins[:, 1].min()), float(origins[:, 1].max())]
    for candidate in candidates:
        if candidate.axis == 0:
            xs.append(candidate.offset_m)
            ys.extend((candidate.support_u_min_m, candidate.support_u_max_m))
        else:
            ys.append(candidate.offset_m)
            xs.extend((candidate.support_u_min_m, candidate.support_u_max_m))
    margin = 0.75
    return min(xs) - margin, max(xs) + margin, min(ys) - margin, max(ys) + margin


def _mapper(bounds: tuple[float, float, float, float]):
    x0, x1, y0, y1 = bounds
    scale = min(
        (PLOT_RIGHT - PLOT_LEFT) / max(x1 - x0, 1e-9),
        (PLOT_BOTTOM - PLOT_TOP) / max(y1 - y0, 1e-9),
    )
    used_w = (x1 - x0) * scale
    used_h = (y1 - y0) * scale
    pad_x = 0.5 * ((PLOT_RIGHT - PLOT_LEFT) - used_w)
    pad_y = 0.5 * ((PLOT_BOTTOM - PLOT_TOP) - used_h)

    def project(x: np.ndarray | float, y: np.ndarray | float):
        px = PLOT_LEFT + pad_x + (np.asarray(x) - x0) * scale
        py = PLOT_TOP + pad_y + (y1 - np.asarray(y)) * scale
        return px, py

    return project, scale


def render_top_view_svg(
    path: Path,
    *,
    points: np.ndarray,
    origins: np.ndarray,
    measurement: room_shape.RoomShapeMeasurement,
    proposal_sha256: str,
) -> dict[str, Any]:
    """Write one deterministic room-frame context/candidate diagram."""
    points = np.asarray(points, dtype=float)
    origins = np.asarray(origins, dtype=float)
    floor_point = np.asarray(measurement.frame.floor_point, dtype=float)
    rotation = np.asarray(measurement.rotation, dtype=float)
    room_origins = (origins - floor_point) @ rotation.T
    bounds = _bounds(measurement.candidates, room_origins)
    project, scale = _mapper(bounds)

    stride = max(1, int(math.ceil(points.shape[0] / MAX_CONTEXT_POINTS)))
    sampled = (points[::stride] - floor_point) @ rotation.T
    x0, x1, y0, y1 = bounds
    ceiling = max(measurement.frame.ceiling_height_m, 0.5)
    keep = (
        (sampled[:, 0] >= x0)
        & (sampled[:, 0] <= x1)
        & (sampled[:, 1] >= y0)
        & (sampled[:, 1] <= y1)
        & (sampled[:, 2] >= -0.30)
        & (sampled[:, 2] <= ceiling + 0.50)
    )
    sampled = sampled[keep]
    px, py = project(sampled[:, 0], sampled[:, 1])
    point_path = " ".join(
        f"M{float(x):.2f},{float(y):.2f}h0.8" for x, y in zip(px, py)
    )

    metadata = {
        "schemaVersion": "omnitwin.foundry.room-shape-diagnostic.v0",
        "proposalSha256": proposal_sha256,
        "authority": "none",
        "state": measurement.state,
        "refusals": list(measurement.refusals),
        "samplePolicy": {
            "kind": "fixed_stride",
            "inputPointCount": int(points.shape[0]),
            "stride": stride,
            "renderedPointCount": int(sampled.shape[0]),
        },
        "roomFrameBoundsM": [float(value) for value in bounds],
    }
    refusal_text = ", ".join(measurement.refusals) or "none"
    lines = [
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{SVG_WIDTH}" height="{SVG_HEIGHT}" viewBox="0 0 {SVG_WIDTH} {SVG_HEIGHT}">',
        f"<metadata>{html.escape(json.dumps(metadata, sort_keys=True, separators=(',', ':')))}</metadata>",
        '<rect width="1200" height="900" fill="#f7f4ec"/>',
        '<text x="70" y="48" font-family="system-ui,sans-serif" font-size="26" fill="#163a3a">Room-shape proposer — recovered-frame top view</text>',
        f'<text x="70" y="78" font-family="monospace" font-size="14" fill="#354b4b">proposal {html.escape(proposal_sha256)}</text>',
        f'<text x="70" y="103" font-family="system-ui,sans-serif" font-size="15" fill="#6b2d2d">state: {html.escape(measurement.state)} | refusals: {html.escape(refusal_text)}</text>',
        f'<text x="70" y="127" font-family="system-ui,sans-serif" font-size="13" fill="#526060">fixed-stride context sample: {sampled.shape[0]:,} of {points.shape[0]:,} points (stride {stride}); no outside dimensions used</text>',
        '<rect x="70" y="150" width="1060" height="690" fill="#ffffff" stroke="#b8c4bf"/>',
        f'<path d="{point_path}" stroke="#9aa7a3" stroke-width="0.8" opacity="0.42"/>',
    ]

    for candidate in sorted(
        measurement.candidates,
        key=lambda item: (item.name, item.offset_m),
    ):
        if candidate.axis == 0:
            ax, ay = candidate.offset_m, candidate.support_u_min_m
            bx, by = candidate.offset_m, candidate.support_u_max_m
        else:
            ax, ay = candidate.support_u_min_m, candidate.offset_m
            bx, by = candidate.support_u_max_m, candidate.offset_m
        sx, sy = project(ax, ay)
        ex, ey = project(bx, by)
        if candidate.outboard_review_required:
            colour, dash = "#7b3fa1", "8 4"
        elif candidate.accepted:
            colour, dash = "#16836c", ""
        else:
            colour, dash = "#bd4a45", "4 4"
        width = 3.2 if candidate.accepted else 1.5
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        lines.append(
            f'<line x1="{float(sx):.2f}" y1="{float(sy):.2f}" '
            f'x2="{float(ex):.2f}" y2="{float(ey):.2f}" '
            f'stroke="{colour}" stroke-width="{width}"{dash_attr}/>'
        )

    ox, oy = project(room_origins[:, 0], room_origins[:, 1])
    for index, (x, y) in enumerate(zip(ox, oy)):
        lines.append(
            f'<circle cx="{float(x):.2f}" cy="{float(y):.2f}" r="3.2" '
            'fill="#e28d2d" stroke="#713d0c" stroke-width="0.7"/>'
        )
        if index in (0, len(ox) - 1):
            lines.append(
                f'<text x="{float(x) + 5:.2f}" y="{float(y) - 5:.2f}" '
                'font-family="monospace" font-size="11" fill="#713d0c">'
                f'{index:02d}</text>'
            )

    metres_bar = max(1.0, math.floor(100.0 / max(scale, 1e-9)))
    bar_px = metres_bar * scale
    lines.extend(
        [
            '<line x1="80" y1="865" x2="112" y2="865" stroke="#16836c" stroke-width="4"/>',
            '<text x="120" y="870" font-family="system-ui,sans-serif" font-size="13">accepted surface evidence</text>',
            '<line x1="350" y1="865" x2="382" y2="865" stroke="#7b3fa1" stroke-width="4" stroke-dasharray="8 4"/>',
            '<text x="390" y="870" font-family="system-ui,sans-serif" font-size="13">outboard review required</text>',
            '<line x1="650" y1="865" x2="682" y2="865" stroke="#bd4a45" stroke-width="2" stroke-dasharray="4 4"/>',
            '<text x="690" y="870" font-family="system-ui,sans-serif" font-size="13">rejected candidate</text>',
            f'<line x1="{1050 - bar_px:.2f}" y1="865" x2="1050" y2="865" stroke="#263333" stroke-width="3"/>',
            f'<text x="1060" y="870" font-family="monospace" font-size="12">{metres_bar:g} m</text>',
            "</svg>",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return metadata
