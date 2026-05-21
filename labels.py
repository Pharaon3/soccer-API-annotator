"""Event label definitions (single source of truth for API and validation)."""

from __future__ import annotations

import os
from typing import Any

LABEL_CONFIG: list[dict[str, str]] = [
    {"id": "pass", "key": "q", "display": "Pass"},
    {"id": "pass_received", "key": "w", "display": "Pass received"},
    {"id": "take_on", "key": "e", "display": "Take on"},
    {"id": "recovery", "key": "r", "display": "Recovery"},
    {"id": "tackle", "key": "t", "display": "Tackle"},
    {"id": "aerial_duel", "key": "a", "display": "Aerial duel"},
    {"id": "save", "key": "s", "display": "Save"},
    {"id": "shot", "key": "d", "display": "Shot"},
    {"id": "foul", "key": "f", "display": "Foul"},
    {"id": "goal", "key": "g", "display": "Goal"},
    {"id": "interception", "key": "z", "display": "Interception"},
    {"id": "substitution", "key": "x", "display": "Substitution"},
    {"id": "clearance", "key": "c", "display": "Clearance"},
    {"id": "block", "key": "v", "display": "Block"},
    {"id": "ball_out_of_play", "key": "b", "display": "Ball out"},
]

LABEL_KEYBOARD_ROWS: list[list[str]] = [
    ["pass", "pass_received", "take_on", "recovery", "tackle"],
    ["aerial_duel", "save", "shot", "foul", "goal"],
    ["interception", "substitution", "clearance", "block", "ball_out_of_play"],
]

LABELS: list[str] = [entry["id"] for entry in LABEL_CONFIG]
LABEL_IDS: frozenset[str] = frozenset(LABELS)


def _offset_env_name(label_id: str) -> str:
    safe_label = "".join(ch if ch.isalnum() else "_" for ch in label_id).upper()
    return f"LABEL_FRAME_OFFSET_{safe_label}"


def label_frame_offsets() -> dict[str, int]:
    offsets: dict[str, int] = {}
    for label_id in LABELS:
        raw = os.getenv(_offset_env_name(label_id))
        if raw is None or raw.strip() == "":
            continue
        try:
            offset = int(raw)
        except ValueError:
            continue
        if offset > 0:
            offsets[label_id] = offset
    return offsets


def labels_api_payload() -> dict[str, Any]:
    return {
        "labels": LABEL_CONFIG,
        "keyboard_rows": LABEL_KEYBOARD_ROWS,
        "frame_offsets": label_frame_offsets(),
    }
