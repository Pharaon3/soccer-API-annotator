"""Event label definitions (single source of truth for API and validation)."""

from __future__ import annotations

import os
import logging
from typing import Any

logger = logging.getLogger(__name__)

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
    {"id": "interception", "key": "4", "display": "Interception"},
    {"id": "substitution", "key": "2", "display": "Substitution"},
    {"id": "clearance", "key": "3", "display": "Clearance"},
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
DEFAULT_EVENT_CANDIDATE_SNAP_RANGE_FRAMES = 5


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


def event_candidate_snap_range_frames() -> int:
    raw = os.getenv("EVENT_CANDIDATE_SNAP_RANGE_FRAMES")
    if raw is None or raw.strip() == "":
        return DEFAULT_EVENT_CANDIDATE_SNAP_RANGE_FRAMES
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "Invalid EVENT_CANDIDATE_SNAP_RANGE_FRAMES=%r, using default %d",
            raw,
            DEFAULT_EVENT_CANDIDATE_SNAP_RANGE_FRAMES,
        )
        return DEFAULT_EVENT_CANDIDATE_SNAP_RANGE_FRAMES
    return max(0, value)


def labels_api_payload() -> dict[str, Any]:
    return {
        "labels": LABEL_CONFIG,
        "keyboard_rows": LABEL_KEYBOARD_ROWS,
        "frame_offsets": label_frame_offsets(),
        "event_candidate_snap_range_frames": event_candidate_snap_range_frames(),
    }
