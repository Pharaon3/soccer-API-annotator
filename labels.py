"""Event label definitions (single source of truth for API and validation)."""

from __future__ import annotations

from typing import Any

LABEL_CONFIG: list[dict[str, str]] = [
    {"id": "pass", "key": "p", "display": "Pass"},
    {"id": "pass_received", "key": "[", "display": "Pass received"},
    {"id": "recovery", "key": "r", "display": "Recovery"},
    {"id": "tackle", "key": "t", "display": "Tackle"},
    {"id": "interception", "key": "i", "display": "Interception"},
    {"id": "ball_out_of_play", "key": "o", "display": "Ball out"},
    {"id": "clearance", "key": "c", "display": "Clearance"},
    {"id": "take_on", "key": "y", "display": "Take on"},
    {"id": "substitution", "key": "x", "display": "Substitution"},
    {"id": "block", "key": "b", "display": "Block"},
    {"id": "aerial_duel", "key": "a", "display": "Aerial duel"},
    {"id": "shot", "key": "s", "display": "Shot"},
    {"id": "save", "key": "v", "display": "Save"},
    {"id": "foul", "key": "f", "display": "Foul"},
    {"id": "goal", "key": "g", "display": "Goal"},
]

LABELS: list[str] = [entry["id"] for entry in LABEL_CONFIG]
LABEL_IDS: frozenset[str] = frozenset(LABELS)


def labels_api_payload() -> dict[str, Any]:
    return {"labels": LABEL_CONFIG}
