"""Soccer video annotator API and web UI."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import random
import re
import time
import subprocess
import contextlib
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field, HttpUrl

from auth import (
    AUTH_COOKIE_NAME,
    SESSION_TTL_SEC,
    auth_cookie_params,
    create_session,
    get_session_user_id,
    list_static_user_ids,
    purge_expired_sessions,
    revoke_session,
    static_users_configured,
    validate_startup_config,
    verify_api_key,
    verify_session,
    verify_user_credentials,
)
from labels import LABEL_IDS, labels_api_payload

load_dotenv()

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
VIDEOS_DIR = DATA_DIR / "videos"
ANNOTATIONS_DIR = DATA_DIR / "annotations"
STATIC_DIR = ROOT / "static"


def ensure_data_dirs() -> None:
    for directory in (VIDEOS_DIR, ANNOTATIONS_DIR):
        directory.mkdir(parents=True, exist_ok=True)


ensure_data_dirs()
STATIC_DIR.mkdir(parents=True, exist_ok=True)


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid %s=%r, using default %.2f", name, raw, default)
        return default


ANNOTATE_DURATION_MIN_SEC = _env_float("ANNOTATE_DURATION_MIN_SEC", 25.0)
ANNOTATE_DURATION_MAX_SEC = _env_float("ANNOTATE_DURATION_MAX_SEC", 26.0)
if ANNOTATE_DURATION_MAX_SEC < ANNOTATE_DURATION_MIN_SEC:
    logger.warning(
        "ANNOTATE_DURATION_MAX_SEC %.2f < ANNOTATE_DURATION_MIN_SEC %.2f; clamping max to min",
        ANNOTATE_DURATION_MAX_SEC,
        ANNOTATE_DURATION_MIN_SEC,
    )
    ANNOTATE_DURATION_MAX_SEC = ANNOTATE_DURATION_MIN_SEC

CACHE_HIT_RESPONSE_DELAY_MIN_SEC = _env_float(
    "CACHE_HIT_RESPONSE_DELAY_MIN_SEC", ANNOTATE_DURATION_MIN_SEC
)
CACHE_HIT_RESPONSE_DELAY_MAX_SEC = _env_float(
    "CACHE_HIT_RESPONSE_DELAY_MAX_SEC", ANNOTATE_DURATION_MAX_SEC
)
if CACHE_HIT_RESPONSE_DELAY_MAX_SEC < CACHE_HIT_RESPONSE_DELAY_MIN_SEC:
    logger.warning(
        "CACHE_HIT_RESPONSE_DELAY_MAX_SEC %.2f < CACHE_HIT_RESPONSE_DELAY_MIN_SEC %.2f; clamping max to min",
        CACHE_HIT_RESPONSE_DELAY_MAX_SEC,
        CACHE_HIT_RESPONSE_DELAY_MIN_SEC,
    )
    CACHE_HIT_RESPONSE_DELAY_MAX_SEC = CACHE_HIT_RESPONSE_DELAY_MIN_SEC

RANDOM_FALLBACK_RESPONSE_DELAY_SEC = _env_float(
    "RANDOM_FALLBACK_RESPONSE_DELAY_SEC", ANNOTATE_DURATION_MAX_SEC
)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid %s=%r, using default %d", name, raw, default)
        return default


def random_annotate_duration_sec() -> float:
    return random.uniform(ANNOTATE_DURATION_MIN_SEC, ANNOTATE_DURATION_MAX_SEC)


PRESENCE_IDLE_MINUTES = max(1, _env_int("PRESENCE_IDLE_MINUTES", 15))
PRESENCE_IDLE_SEC = PRESENCE_IDLE_MINUTES * 60
SEGMENT_WINDOW_SEC = 30
SEGMENT_PADDING_SEC = 1.0
FIRST_PART_EXTRA_SEC = 2.0
PRACTICE_INTERVAL_SEC = 30
API_CALL_INTERVAL_SEC = int(os.getenv("API_CALL_INTERVAL_SEC", "3600"))
_next_api_call_at: float | None = None
# Segment proxy encode: 480p height, 25 fps, H.264 ultrafast
SEGMENT_SCALE_FILTER = "scale=-2:480"
SEGMENT_FPS = 25
SEGMENT_CRF = 28
SEGMENT_FFMPEG_PRESET = "ultrafast"


def segment_core_bounds(rank: int, total: int) -> tuple[float, float]:
    """First annotator gets +FIRST_PART_EXTRA_SEC; remaining window is split evenly."""
    x = max(total, 1)
    base = SEGMENT_WINDOW_SEC / x
    if rank == 1:
        return 0.0, min(SEGMENT_WINDOW_SEC, base + FIRST_PART_EXTRA_SEC)
    first_end = min(SEGMENT_WINDOW_SEC, base + FIRST_PART_EXTRA_SEC)
    remaining = SEGMENT_WINDOW_SEC - first_end
    slice_other = remaining / max(x - 1, 1)
    core_start = first_end + slice_other * (rank - 2)
    return core_start, core_start + slice_other


def segment_start_sec(rank: int, total: int) -> float:
    return segment_core_bounds(rank, total)[0]


def segment_end_sec(rank: int, total: int) -> float:
    return segment_core_bounds(rank, total)[1]


def segment_duration_sec(rank: int, total: int) -> float:
    return segment_end_sec(rank, total) - segment_start_sec(rank, total)


def padded_playback_bounds(
    rank: int, total: int
) -> tuple[float, float, float, float]:
    """Core segment plus ±SEGMENT_PADDING_SEC, clamped to the 30s window."""
    global_start = segment_start_sec(rank, total)
    global_end = segment_end_sec(rank, total)
    play_start = max(0.0, global_start - SEGMENT_PADDING_SEC)
    play_end = min(SEGMENT_WINDOW_SEC, global_end + SEGMENT_PADDING_SEC)
    return play_start, play_end, global_start, global_end


def playback_timing_for_rank(rank: int, total: int) -> dict[str, float]:
    """Map annotator rank to local playback range and global timeline origin."""
    play_start, play_end, global_start, global_end = padded_playback_bounds(
        rank, total
    )
    clip_duration = play_end - play_start
    if annotator_uses_original_video(rank):
        return {
            "start_offset_sec": play_start,
            "time_origin_sec": play_start,
            "segment_end_sec": play_end,
            "clip_duration_sec": clip_duration,
            "segment_core_start_sec": global_start,
            "segment_core_end_sec": global_end,
        }
    return {
        "start_offset_sec": 0.0,
        "time_origin_sec": play_start,
        "segment_end_sec": clip_duration,
        "clip_duration_sec": clip_duration,
        "segment_core_start_sec": global_start,
        "segment_core_end_sec": global_end,
    }


_VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,200}$")


def video_id_from_url(video_url: str) -> str:
    """Derive video id from the original file name in the URL path."""
    path = urlparse(video_url).path
    name = unquote(path.rstrip("/").split("/")[-1])
    if not name:
        raise ValueError(f"Cannot derive video id from URL: {video_url}")
    if name.lower().endswith(".mp4"):
        name = name[:-4]
    if not name or not _VIDEO_ID_RE.match(name):
        raise ValueError(f"Invalid video id from URL: {video_url}")
    return name


def safe_video_id(video_id: str) -> bool:
    return bool(_VIDEO_ID_RE.match(video_id))


def public_video_path(video_id: str) -> str:
    return f"/api/video/{video_id}"


def job_seconds_left(deadline_at: float, duration_sec: float) -> int:
    """Seconds until the annotate job deadline; capped at this job duration."""
    remaining = deadline_at - time.time()
    return max(0, min(int(math.ceil(duration_sec)), int(math.ceil(remaining))))


def _random_confidence() -> float:
    return round(random.uniform(0.6, 0.9), 2)


def _confidence_value(value: Any = None) -> float:
    if value is None:
        return _random_confidence()
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return _random_confidence()


def _api_prediction(
    frame: int, action: str, confidence: Any = None
) -> dict[str, Any]:
    return {
        "frame": int(frame),
        "action": action,
        "confidence": _confidence_value(confidence),
    }


def events_to_predictions(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert internal job events to API predictions format."""
    predictions: list[dict[str, Any]] = []
    for e in sorted(events, key=lambda x: float(x.get("time_sec", 0))):
        frame = e.get("frame")
        if frame is None:
            frame = int(round(float(e["time_sec"]) * SEGMENT_FPS))
        predictions.append(_api_prediction(int(frame), e["label"], e.get("confidence")))
    return predictions


def annotations_api_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize stored JSON (legacy events or predictions) for API consumers."""
    if "predictions" in data:
        raw = data["predictions"]
        return {
            "predictions": [
                _api_prediction(
                    p["frame"],
                    p.get("action", p.get("label", "")),
                    p.get("confidence"),
                )
                for p in raw
            ]
        }
    return {"predictions": events_to_predictions(data.get("events", []))}


def _labelers_from_events(events: list[dict[str, Any]]) -> dict[str, str]:
    labelers: dict[str, str] = {}
    for event in events:
        participant_id = event.get("participant_id")
        user_id = event.get("user_id")
        if participant_id is None or not user_id:
            continue
        labelers[str(participant_id)] = str(user_id)
    return labelers


def _serialize_stored_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stored: list[dict[str, Any]] = []
    for event in sorted(events, key=lambda x: float(x.get("time_sec", 0))):
        frame = event.get("frame")
        if frame is None:
            frame = int(round(float(event["time_sec"]) * SEGMENT_FPS))
        confidence = _confidence_value(event.get("confidence"))
        item: dict[str, Any] = {
            "time_sec": round(float(event["time_sec"]), 2),
            "label": event["label"],
            "participant_id": event.get("participant_id"),
            "frame": int(frame),
            "confidence": confidence,
        }
        if event.get("user_id"):
            item["user_id"] = event["user_id"]
        stored.append(item)
    return stored


def persist_video_annotations(
    *,
    video_id: str,
    video_url: str,
    video_path: Path,
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    """Write predictions, detailed events, and labeler map to disk."""
    ensure_data_dirs()
    stored_events = _serialize_stored_events(events)
    predictions = events_to_predictions(stored_events)
    labelers = _labelers_from_events(events)
    payload: dict[str, Any] = {
        "predictions": predictions,
        "events": stored_events,
        "labelers": labelers,
    }
    content_hash = file_content_hash(video_path)
    meta, events_file, _ = cache_paths(video_id)
    events_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    meta_payload: dict[str, Any] = {
        "video_url": video_url,
        "video_id": video_id,
        "content_hash": content_hash,
        "saved_at": time.time(),
        "local_file": video_path.name if video_path.is_file() else None,
        "labelers": labelers,
    }
    meta.write_text(json.dumps(meta_payload, indent=2), encoding="utf-8")
    return payload


def annotations_detail_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Full annotation payload for the board UI (includes labeler names)."""
    labelers = data.get("labelers") or {}
    if "events" in data:
        events = data["events"]
    elif "predictions" in data:
        events = [
            {
                "time_sec": round(float(p["frame"]) / SEGMENT_FPS, 2),
                "label": p.get("action", p.get("label", "")),
                "frame": int(p["frame"]),
                "confidence": _confidence_value(p.get("confidence")),
                "participant_id": p.get("participant_id"),
                "user_id": p.get("user_id"),
            }
            for p in data["predictions"]
        ]
    else:
        events = data.get("events", [])
    if not labelers and events:
        labelers = _labelers_from_events(events)
    return {
        "predictions": annotations_api_payload(data).get("predictions", []),
        "events": events,
        "labelers": labelers,
    }


def _remove_annotation_event(
    events: list[dict[str, Any]], time_sec: float, label: str
) -> bool:
    target_t = round(float(time_sec), 2)
    for i, event in enumerate(events):
        if event.get("time_sec") == target_t and event.get("label") == label:
            events.pop(i)
            return True
    return False


@dataclass
class AnnotatorSession:
    websocket: WebSocket
    annotator_id: int
    joined_at: float = field(default_factory=time.time)
    online: bool = True
    user_id: str | None = None
    practice_mode: str = "sync"  # "sync" | "private"


def annotator_access_payload(session: AnnotatorSession) -> dict[str, Any]:
    client = session.websocket.client
    return {
        "annotator_id": session.annotator_id,
        "user_id": session.user_id,
        "ip": client.host if client else None,
        "port": client.port if client else None,
        "online": session.online,
        "joined_at": session.joined_at,
    }


def annotator_status_payload(session: AnnotatorSession | None) -> dict[str, Any]:
    if session is None:
        return {"status": "offline"}
    return {
        "status": "online" if session.online else "idle",
        "annotator_id": session.annotator_id,
        "user_id": session.user_id,
        "joined_at": session.joined_at,
    }


@dataclass
class ActiveJob:
    job_id: str
    video_url: str
    video_id: str
    started_at: float
    deadline_at: float
    duration_sec: float
    segment_total: int = 1
    rank_by_participant_id: dict[int, int] = field(default_factory=dict)
    dispatch_session_ids: list[int] = field(default_factory=list)


@dataclass
class JobVideoTiming:
    """Server-side timing for download and per-rank segment encoding."""

    job_id: str
    video_id: str
    annotator_count: int
    api_started_at: float
    download_sec: float | None = None
    download_cached: bool = False
    download_size_mb: float | None = None
    segment_sec_by_rank: dict[int, float] = field(default_factory=dict)
    dispatch_wall_sec: float | None = None
    completed_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        divide_cpu_total = (
            round(sum(self.segment_sec_by_rank.values()), 2)
            if self.segment_sec_by_rank
            else None
        )
        return {
            "job_id": self.job_id,
            "video_id": self.video_id,
            "annotator_count": self.annotator_count,
            "download_original_sec": self.download_sec,
            "download_cached": self.download_cached,
            "download_size_mb": self.download_size_mb,
            "divide_segment_sec_by_rank": dict(self.segment_sec_by_rank),
            "divide_cpu_total_sec": divide_cpu_total,
            "dispatch_wall_sec": self.dispatch_wall_sec,
            "elapsed_since_api_sec": (
                round(self.completed_at - self.api_started_at, 2)
                if self.completed_at is not None
                else None
            ),
        }


@dataclass
class TestJobState:
    job_id: str
    video_id: str
    video_url: str
    segment_total: int
    rank_by_participant_id: dict[int, int]


class AnnotateRequest(BaseModel):
    video_url: HttpUrl


class LoginRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


def _auth_token(request: Request) -> str | None:
    return request.cookies.get(AUTH_COOKIE_NAME)


def _require_auth(request: Request) -> str:
    token = _auth_token(request)
    if not verify_session(token):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return token or ""


def _is_authenticated(request: Request) -> bool:
    return verify_session(_auth_token(request))


def _login_redirect() -> RedirectResponse:
    return RedirectResponse(url="/login", status_code=302)


_PROTECTED_PAGE_PATHS = frozenset({"/", "/annotator", "/board", "/practice", "/review", "/train"})


def _is_browser_page_path(path: str) -> bool:
    normalized = path.rstrip("/") or "/"
    return normalized in _PROTECTED_PAGE_PATHS


def _should_redirect_unauthenticated(request: Request) -> bool:
    if request.url.path.startswith("/api/"):
        return False
    if _is_browser_page_path(request.url.path):
        return True
    accept = request.headers.get("accept", "")
    if "application/json" in accept and "text/html" not in accept:
        return False
    return "text/html" in accept


def schedule_next_api_call(at: float | None = None) -> float:
    """Schedule the next expected external API call."""
    global _next_api_call_at
    _next_api_call_at = (
        float(at) if at is not None else time.time() + API_CALL_INTERVAL_SEC
    )
    return _next_api_call_at


def api_seconds_left() -> int | None:
    if _next_api_call_at is None:
        return None
    return max(0, int(math.ceil(_next_api_call_at - time.time())))


def api_schedule_payload() -> dict[str, Any]:
    return {
        "type": "api_schedule",
        "seconds_left": api_seconds_left(),
        "interval_sec": API_CALL_INTERVAL_SEC,
    }


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()
        self.participants: dict[int, AnnotatorSession] = {}
        self.annotators: dict[int, AnnotatorSession] = {}
        self.test_annotators: dict[int, AnnotatorSession] = {}
        self.reviewers: set[WebSocket] = set()
        self._next_participant_id = 0
        self._next_test_round_at: float | None = None

    @property
    def annotator_count(self) -> int:
        return len(self.annotators)

    @property
    def online_annotator_count(self) -> int:
        return sum(1 for session in self.annotators.values() if session.online)

    @property
    def participant_count(self) -> int:
        return len(self.participants)

    @property
    def test_annotator_count(self) -> int:
        return len(self.test_annotators)

    def _new_participant(
        self, ws: WebSocket, *, user_id: str | None = None
    ) -> AnnotatorSession:
        self._next_participant_id += 1
        session = AnnotatorSession(
            websocket=ws,
            annotator_id=self._next_participant_id,
            user_id=user_id,
        )
        self.participants[session.annotator_id] = session
        return session

    def schedule_next_test_round(self, at: float | None = None) -> float:
        if at is None:
            now = time.time()
            at = now + (PRACTICE_INTERVAL_SEC - (now % PRACTICE_INTERVAL_SEC))
        self._next_test_round_at = at
        return at

    async def register_annotator(
        self, ws: WebSocket, *, user_id: str | None = None
    ) -> AnnotatorSession:
        session = self._new_participant(ws, user_id=user_id)
        self.annotators[session.annotator_id] = session
        await self._broadcast_annotator_count()
        await self.broadcast_annotator_roster()
        return session

    async def register_test_annotator(
        self, ws: WebSocket, *, user_id: str | None = None
    ) -> AnnotatorSession:
        session = self._new_participant(ws, user_id=user_id)
        self.test_annotators[session.annotator_id] = session
        self.annotators[session.annotator_id] = session
        await self._broadcast_annotator_count()
        await self.broadcast_annotator_roster()
        return session

    async def register_reviewer(
        self, ws: WebSocket, *, user_id: str | None = None
    ) -> AnnotatorSession:
        session = self._new_participant(ws, user_id=user_id)
        self.reviewers.add(ws)
        self.annotators[session.annotator_id] = session
        await self._broadcast_annotator_count()
        await self.broadcast_annotator_roster()
        return session

    async def send_api_schedule(self, ws: WebSocket) -> None:
        await ws.send_text(json.dumps(api_schedule_payload()))

    async def broadcast_api_schedule(self) -> None:
        msg = json.dumps(api_schedule_payload())
        dead: list[int] = []
        for aid, session in list(self.annotators.items()):
            try:
                await session.websocket.send_text(msg)
            except Exception:
                dead.append(aid)
        for aid in dead:
            await self._drop_participant(aid)

    async def notify_api_call_started(self, video_id: str) -> None:
        """Tell every connected workspace client that a new API job was requested."""
        schedule_next_api_call(time.time() + API_CALL_INTERVAL_SEC)
        msg = json.dumps(
            {
                "type": "api_call_started",
                "video_id": video_id,
                "seconds_left": api_seconds_left(),
                "interval_sec": API_CALL_INTERVAL_SEC,
            }
        )
        delivered: set[WebSocket] = set()
        dead: list[int] = []
        for aid, session in list(self.participants.items()):
            try:
                await session.websocket.send_text(msg)
                delivered.add(session.websocket)
            except Exception:
                dead.append(aid)
        for aid in dead:
            await self._drop_participant(aid)
        dead_connections: set[WebSocket] = set()
        for ws in self.connections - delivered:
            try:
                await ws.send_text(msg)
            except Exception:
                dead_connections.add(ws)
        self.connections -= dead_connections

    async def broadcast_api_call_started(self, video_id: str) -> None:
        """Alias used at API entry; keeps online annotators in sync for job dispatch."""
        await self.notify_api_call_started(video_id)

    async def send_test_schedule(self, ws: WebSocket) -> None:
        if self._next_test_round_at is None:
            self.schedule_next_test_round()
        await ws.send_text(
            json.dumps(
                {
                    "type": "test_schedule",
                    "next_round_at": self._next_test_round_at,
                    "interval_sec": PRACTICE_INTERVAL_SEC,
                }
            )
        )

    async def broadcast_test_schedule(self) -> None:
        if self._next_test_round_at is None:
            self.schedule_next_test_round()
        msg = json.dumps(
            {
                "type": "test_schedule",
                "next_round_at": self._next_test_round_at,
                "interval_sec": PRACTICE_INTERVAL_SEC,
            }
        )
        dead: list[int] = []
        for aid, session in self.test_annotators.items():
            if session.practice_mode != "sync":
                continue
            try:
                await session.websocket.send_text(msg)
            except Exception:
                dead.append(aid)
        for aid in dead:
            del self.test_annotators[aid]

    async def leave_role(self, ws: WebSocket) -> None:
        for aid, s in list(self.annotators.items()):
            if s.websocket is ws:
                del self.annotators[aid]
        for aid, s in list(self.test_annotators.items()):
            if s.websocket is ws:
                del self.test_annotators[aid]
        self.reviewers.discard(ws)
        removed = [
            aid for aid, s in self.participants.items() if s.websocket is ws
        ]
        for aid in removed:
            del self.participants[aid]
        if removed:
            await self._broadcast_annotator_count()
            await self.broadcast_annotator_roster()

    async def disconnect_user(self, user_id: str) -> None:
        sessions = [
            session
            for session in self.snapshot_participants()
            if session.user_id == user_id
        ]
        for session in sessions:
            try:
                await session.websocket.close(code=4001, reason="Logged in elsewhere")
            except Exception:
                pass
            await self._drop_participant(session.annotator_id)
        if sessions:
            await self._broadcast_annotator_count()
            await self.broadcast_annotator_roster()

    async def set_session_online(self, session: AnnotatorSession, online: bool) -> None:
        session.online = online
        try:
            await session.websocket.send_text(
                json.dumps({"type": "presence_status", "online": online})
            )
        except Exception:
            pass
        await self._broadcast_annotator_count()
        await self.broadcast_annotator_roster()

    async def set_user_online(self, user_id: str, online: bool) -> bool:
        target = next(
            (
                session
                for session in self.snapshot_participants()
                if session.user_id == user_id
            ),
            None,
        )
        if target is None:
            return False
        await self.set_session_online(target, online)
        return True

    async def _broadcast_annotator_count(self) -> None:
        msg = json.dumps(
            {
                "type": "annotator_count",
                "count": self.annotator_count,
                "online_count": self.online_annotator_count,
            }
        )
        dead: list[int] = []
        for aid, session in self.participants.items():
            try:
                await session.websocket.send_text(msg)
            except Exception:
                dead.append(aid)
        for aid in dead:
            await self._drop_participant(aid)
        if dead:
            await self.broadcast_annotator_roster()

    def annotator_roster_payload(self) -> dict[str, Any]:
        sessions_by_user = {
            session.user_id: session
            for session in self.snapshot_participants()
            if session.user_id
        }
        return {
            "type": "annotator_roster",
            "annotators": [
                {
                    "user_id": user_id,
                    **annotator_status_payload(sessions_by_user.get(user_id)),
                }
                for user_id in list_static_user_ids()
            ],
        }

    async def send_annotator_roster(self, ws: WebSocket) -> None:
        await ws.send_text(json.dumps(self.annotator_roster_payload()))

    async def broadcast_annotator_roster(self) -> None:
        msg = json.dumps(self.annotator_roster_payload())
        dead: list[int] = []
        for aid, session in list(self.participants.items()):
            try:
                await session.websocket.send_text(msg)
            except Exception:
                dead.append(aid)
        for aid in dead:
            await self._drop_participant(aid)

    async def _drop_participant(self, participant_id: int) -> None:
        session = self.participants.pop(participant_id, None)
        if not session:
            return
        ws = session.websocket
        self.annotators.pop(participant_id, None)
        self.test_annotators.pop(participant_id, None)
        self.reviewers.discard(ws)

    def rank_of_participant(self, participant_id: int) -> int:
        ordered = sorted(self.participants.keys())
        return ordered.index(participant_id) + 1

    def snapshot_participants(self) -> list[AnnotatorSession]:
        return sorted(self.participants.values(), key=lambda s: s.annotator_id)

    def snapshot_online_annotators(self) -> list[AnnotatorSession]:
        return sorted(
            (s for s in self.annotators.values() if s.online),
            key=lambda s: s.annotator_id,
        )

    def snapshot_test_annotators(self) -> list[AnnotatorSession]:
        return sorted(self.test_annotators.values(), key=lambda s: s.annotator_id)

    def snapshot_online_test_annotators(self) -> list[AnnotatorSession]:
        return sorted(
            (
                s
                for s in self.test_annotators.values()
                if s.online and s.practice_mode == "sync"
            ),
            key=lambda s: s.annotator_id,
        )

    @staticmethod
    def ranks_for_sessions(sessions: list[AnnotatorSession]) -> dict[int, int]:
        return {s.annotator_id: rank for rank, s in enumerate(sessions, start=1)}

    def start_offset_for(self, annotator_index: int, total: int | None = None) -> float:
        x = max(total if total is not None else self.annotator_count, 1)
        return segment_start_sec(annotator_index, x)

    def segment_end_for(self, annotator_index: int, total: int | None = None) -> float:
        x = max(total if total is not None else self.annotator_count, 1)
        return segment_end_sec(annotator_index, x)

    def segment_bounds(
        self, annotator_index: int, total: int | None = None
    ) -> tuple[float, float]:
        return self.start_offset_for(annotator_index, total), self.segment_end_for(
            annotator_index, total
        )

    def _annotate_start_payload(
        self, job: ActiveJob, rank: int, session: AnnotatorSession
    ) -> dict[str, Any]:
        x = job.segment_total
        timing = playback_timing_for_rank(rank, x)
        if annotator_uses_original_video(rank):
            playback_video_id = job.video_id
        else:
            playback_video_id = segment_video_id(job.video_id, rank)
        return {
            "type": "annotate_start",
            "job_id": job.job_id,
            "video_id": playback_video_id,
            "original_video_id": job.video_id,
            "video_file": public_video_path(job.video_id),
            "source_url": job.video_url,
            "annotator_id": session.annotator_id,
            "annotator_index": rank,
            "annotator_total": x,
            "segment_window_sec": SEGMENT_WINDOW_SEC,
            "duration_sec": round(job.duration_sec, 2),
            "seconds_left": job_seconds_left(job.deadline_at, job.duration_sec),
            **timing,
        }

    async def _send_annotate_start(
        self, job: ActiveJob, session: AnnotatorSession, rank: int
    ) -> bool:
        try:
            await session.websocket.send_text(
                json.dumps(self._annotate_start_payload(job, rank, session))
            )
            return True
        except Exception:
            logger.exception(
                "annotate_start send failed job=%s aid=%s rank=%s",
                job.job_id,
                session.annotator_id,
                rank,
            )
            return False

    def sync_job_online_annotators(self, job: ActiveJob) -> bool:
        """Refresh job ranks from currently online annotators (before dispatch / reconnect)."""
        online = self.snapshot_online_annotators()
        if not online:
            return False
        job.rank_by_participant_id = self.ranks_for_sessions(online)
        job.segment_total = len(online)
        job.dispatch_session_ids = [s.annotator_id for s in online]
        return True

    async def notify_annotate_ranks(self, job: ActiveJob, ranks: set[int]) -> None:
        self.sync_job_online_annotators(job)
        dead: list[int] = []
        targets: list[AnnotatorSession] = []
        for aid in job.dispatch_session_ids:
            session = self.annotators.get(aid)
            if session and session.online:
                targets.append(session)
        if not targets:
            targets = self.snapshot_online_annotators()
        if not targets:
            logger.warning(
                "annotate_start: no online annotators job=%s ranks=%s map=%s",
                job.job_id,
                sorted(ranks),
                job.rank_by_participant_id,
            )
            return
        sent = 0
        for session in targets:
            rank = job.rank_by_participant_id.get(session.annotator_id)
            if rank is None or rank not in ranks:
                logger.info(
                    "annotate_start skip aid=%s rank=%s need=%s map=%s",
                    session.annotator_id,
                    rank,
                    sorted(ranks),
                    job.rank_by_participant_id,
                )
                continue
            logger.info(
                "annotate_start send job=%s aid=%s rank=%s/%s",
                job.job_id,
                session.annotator_id,
                rank,
                job.segment_total,
            )
            if await self._send_annotate_start(job, session, rank):
                sent += 1
            else:
                dead.append(session.annotator_id)
        if sent == 0:
            logger.warning(
                "annotate_start: no messages sent job=%s ranks=%s targets=%s map=%s",
                job.job_id,
                sorted(ranks),
                [s.annotator_id for s in targets],
                job.rank_by_participant_id,
            )
        for aid in dead:
            await self._drop_participant(aid)

    async def dispatch_annotate_job_videos(
        self,
        job: ActiveJob,
        video_path: Path,
        *,
        timing: JobVideoTiming,
    ) -> None:
        """Notify each annotator as soon as their file is ready (no wait for all encodes)."""
        x = job.segment_total
        video_id = job.video_id

        rank_one = {r for r in job.rank_by_participant_id.values() if r == 1}
        if rank_one:
            await self.notify_annotate_ranks(job, rank_one)
        elif x >= 1:
            logger.warning(
                "dispatch: no rank-1 annotator job=%s map=%s total=%d",
                job.job_id,
                job.rank_by_participant_id,
                x,
            )

        segment_ranks = [rank for rank in range(2, x + 1)]

        async def encode_and_notify(rank: int) -> None:
            start, play_end, _, _ = padded_playback_bounds(rank, x)
            duration = play_end - start
            dest = segment_video_path(video_id, rank)
            step_started = time.time()
            await split_video_segment(video_path, dest, start, duration)
            encode_sec = time.time() - step_started
            timing.segment_sec_by_rank[rank] = encode_sec
            _log_job_phase(
                timing,
                "divide_segment",
                encode_sec,
                rank=rank,
                path=dest,
            )
            await self.notify_annotate_ranks(job, {rank})

        if segment_ranks:
            await asyncio.gather(*[encode_and_notify(rank) for rank in segment_ranks])

    async def broadcast_annotate_job(self, job: ActiveJob) -> None:
        await self.notify_annotate_ranks(
            job, set(job.rank_by_participant_id.values())
        )

    async def send_active_annotate_job(self, session: AnnotatorSession) -> None:
        if (
            not session.online
            or session.annotator_id not in self.annotators
            or not active_jobs
        ):
            return
        job_id, job = max(active_jobs.items(), key=lambda item: item[1].started_at)
        rank = job.rank_by_participant_id.get(session.annotator_id)
        if rank is None:
            self.sync_job_online_annotators(job)
            rank = job.rank_by_participant_id.get(session.annotator_id)
        if rank is None:
            return
        await session.websocket.send_text(
            json.dumps(self._annotate_start_payload(job, rank, session))
        )
        for event in job_events.get(job_id, []):
            await session.websocket.send_text(
                json.dumps(
                    {
                        "type": "job_event",
                        "job_id": job_id,
                        "action": "add",
                        "event": event,
                    }
                )
            )

    def _test_start_payload(
        self,
        state: TestJobState,
        rank: int,
        session: AnnotatorSession,
        *,
        deadline_at: float,
        duration_sec: float,
    ) -> dict[str, Any]:
        x = state.segment_total
        return {
            "type": "test_start",
            "job_id": state.job_id,
            "video_id": state.video_id,
            "duration_sec": round(duration_sec, 2),
            "seconds_left": job_seconds_left(deadline_at, duration_sec),
            "video_file": public_video_path(state.video_id),
            "source_url": state.video_url,
            "annotator_id": session.annotator_id,
            "annotator_index": rank,
            "annotator_total": x,
            "segment_window_sec": SEGMENT_WINDOW_SEC,
            **playback_timing_for_rank(rank, x),
        }

    async def broadcast_test_job(
        self, state: TestJobState, *, deadline_at: float, duration_sec: float
    ) -> None:
        dead: list[int] = []
        for aid in sorted(
            state.rank_by_participant_id, key=state.rank_by_participant_id.get
        ):
            rank = state.rank_by_participant_id[aid]
            session = self.test_annotators.get(aid)
            if not session or session.practice_mode != "sync":
                continue
            try:
                await session.websocket.send_text(
                    json.dumps(
                        self._test_start_payload(
                                state,
                                rank,
                                session,
                                deadline_at=deadline_at,
                                duration_sec=duration_sec,
                        )
                    )
                )
            except Exception:
                dead.append(session.annotator_id)
        for aid in dead:
            del self.test_annotators[aid]

    async def broadcast_job_event(
        self,
        job_id: str,
        event: dict[str, Any],
        action: str,
        *,
        test_only: bool = False,
    ) -> None:
        msg = json.dumps(
            {"type": "job_event", "job_id": job_id, "action": action, "event": event}
        )
        targets = (
            self.test_annotators.values()
            if test_only
            else self.participants.values()
        )
        dead: list[int] = []
        for session in targets:
            try:
                await session.websocket.send_text(msg)
            except Exception:
                dead.append(session.annotator_id)
        if test_only:
            for aid in dead:
                del self.test_annotators[aid]
        else:
            for aid in dead:
                await self._drop_participant(aid)

    async def notify_duplicate_cache_hit(
        self,
        *,
        requested_video_id: str,
        matched_video_id: str,
        reason: str,
    ) -> None:
        if reason == "same_id":
            detail = (
                f"Video «{requested_video_id}» was already annotated. "
                "Stop working — no new round will be saved."
            )
        else:
            detail = (
                f"This file matches earlier video «{matched_video_id}» (same content). "
                "Stop working — it was already annotated."
            )
        msg = json.dumps(
            {
                "type": "duplicate_cache_hit",
                "requested_video_id": requested_video_id,
                "matched_video_id": matched_video_id,
                "reason": reason,
                "message": detail,
            }
        )
        dead: list[int] = []
        for session in list(self.participants.values()):
            try:
                await session.websocket.send_text(msg)
            except Exception:
                dead.append(session.annotator_id)
        for aid in dead:
            await self._drop_participant(aid)

    async def notify_reviewers_video_saved(self, video_id: str) -> None:
        del video_id  # broadcast is a simple refresh signal
        msg = json.dumps({"type": "videos_updated"})
        dead: set[WebSocket] = set()
        for ws in self.reviewers:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.add(ws)
        self.reviewers -= dead


manager = ConnectionManager()
active_jobs: dict[str, ActiveJob] = {}
job_events: dict[str, list[dict[str, Any]]] = {}
active_test_jobs: set[str] = set()
test_job_events: dict[str, list[dict[str, Any]]] = {}
test_job_states: dict[str, TestJobState] = {}
last_annotate_timing: JobVideoTiming | None = None


def cache_paths(video_id: str) -> tuple[Path, Path, Path]:
    meta = ANNOTATIONS_DIR / f"{video_id}.meta.json"
    events_file = ANNOTATIONS_DIR / f"{video_id}.json"
    return meta, events_file, VIDEOS_DIR / f"{video_id}.mp4"

def annotator_uses_original_video(rank: int) -> bool:
    """First annotator plays the full downloaded file; others get encoded slices."""
    return rank == 1


def segment_video_id(video_id: str, rank: int) -> str:
    return f"{video_id}_part_{rank}"


def segment_video_path(video_id: str, rank: int) -> Path:
    return VIDEOS_DIR / f"{segment_video_id(video_id, rank)}.mp4"


def cleanup_segment_videos(video_id: str) -> None:
    for segment_file in VIDEOS_DIR.glob(f"{video_id}_part_*.mp4"):
        try:
            segment_file.unlink()
        except FileNotFoundError:
            continue
        except OSError:
            logger.exception("Failed to delete segment video %s", segment_file)


def _elapsed_since(started_at: float) -> float:
    return time.time() - started_at


def _file_size_mb(path: Path) -> float | None:
    if not path.is_file():
        return None
    return path.stat().st_size / (1024 * 1024)


def _log_job_phase(
    timing: JobVideoTiming,
    phase: str,
    duration_sec: float,
    *,
    rank: int | None = None,
    cached: bool = False,
    path: Path | None = None,
) -> None:
    elapsed = _elapsed_since(timing.api_started_at)
    rank_part = f" rank={rank}" if rank is not None else ""
    cache_part = " cached=yes" if cached else ""
    size_mb = _file_size_mb(path) if path else None
    size_part = f" size_mb={size_mb:.2f}" if size_mb is not None else ""
    logger.info(
        "Job video timing job_id=%s video_id=%s phase=%s%s"
        " duration_sec=%.2f elapsed_since_api_sec=%.2f%s%s",
        timing.job_id,
        timing.video_id,
        phase,
        rank_part,
        duration_sec,
        elapsed,
        cache_part,
        size_part,
    )


def _log_job_timing_summary(timing: JobVideoTiming) -> None:
    if timing.segment_sec_by_rank:
        per_rank = ", ".join(
            f"rank{r}={sec:.2f}s"
            for r, sec in sorted(timing.segment_sec_by_rank.items())
        )
        divide_cpu = sum(timing.segment_sec_by_rank.values())
    else:
        per_rank = "none"
        divide_cpu = 0.0
    logger.info(
        "Job video timing summary job_id=%s video_id=%s annotators=%d"
        " download_original_sec=%s download_cached=%s"
        " divide_segments={%s} divide_cpu_total_sec=%.2f dispatch_wall_sec=%s",
        timing.job_id,
        timing.video_id,
        timing.annotator_count,
        f"{timing.download_sec:.2f}" if timing.download_sec is not None else "—",
        timing.download_cached,
        per_rank,
        divide_cpu,
        f"{timing.dispatch_wall_sec:.2f}" if timing.dispatch_wall_sec is not None else "—",
    )


async def split_video_segment(src: Path, dest: Path, start: float, duration: float) -> None:
    ensure_data_dirs()
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        str(start),
        "-i",
        str(src),
        "-t",
        str(duration),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        str(dest),
    ]

    await asyncio.to_thread(
        subprocess.run,
        cmd,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def file_content_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_annotations_payload(video_id: str) -> dict[str, Any] | None:
    _, events_file, _ = cache_paths(video_id)
    if not events_file.is_file():
        return None
    return annotations_api_payload(
        json.loads(events_file.read_text(encoding="utf-8"))
    )


def random_generated_events() -> list[dict[str, Any]]:
    labels = ["pass", "pass_received", "tackle"]
    event_count = random.randint(3, 5)
    sample_times = sorted(random.uniform(1.0, SEGMENT_WINDOW_SEC - 1.0) for _ in range(event_count))
    return [
        {
            "time_sec": round(time_sec, 2),
            "label": random.choice(labels),
            "participant_id": 0,
            "user_id": "Random generated labels",
        }
        for time_sec in sample_times
    ]


async def generate_random_annotation_fallback(video_url: str) -> dict[str, Any]:
    video_id = video_id_from_url(video_url)
    _, _, video_path = cache_paths(video_id)
    await ensure_video_downloaded(video_url, video_path)
    if RANDOM_FALLBACK_RESPONSE_DELAY_SEC > 0:
        await asyncio.sleep(RANDOM_FALLBACK_RESPONSE_DELAY_SEC)
    payload = await asyncio.to_thread(
        persist_video_annotations,
        video_id=video_id,
        video_url=video_url,
        video_path=video_path,
        events=random_generated_events(),
    )
    await manager.notify_reviewers_video_saved(video_id)
    cleanup_segment_videos(video_id)
    return {"predictions": payload["predictions"]}


def lookup_cached_by_video_id(video_id: str) -> dict[str, Any] | None:
    return _read_annotations_payload(video_id)


def lookup_cached_by_hash(content_hash: str) -> tuple[str, dict[str, Any]] | None:
    for meta_file in ANNOTATIONS_DIR.glob("*.meta.json"):
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if meta.get("content_hash") != content_hash:
            continue
        vid = meta.get("video_id")
        if not vid:
            continue
        payload = _read_annotations_payload(vid)
        if payload is not None:
            return vid, payload
    return None


async def probe_duplicate_annotations(
    video_url: str,
    video_id: str,
    *,
    video_ready: asyncio.Event | None = None,
) -> tuple[str, str, dict[str, Any]] | None:
    """Return (reason, matched_video_id, payload) if this video was already annotated."""
    hit = lookup_cached_by_video_id(video_id)
    if hit is not None:
        return "same_id", video_id, hit

    _, _, video_path = cache_paths(video_id)
    if video_ready is not None:
        try:
            await asyncio.wait_for(video_ready.wait(), timeout=120.0)
        except asyncio.TimeoutError:
            return None
    else:
        await ensure_video_downloaded(video_url, video_path)
    if not video_path.is_file():
        return None
    content_hash = await asyncio.to_thread(file_content_hash, video_path)
    hash_hit = lookup_cached_by_hash(content_hash)
    if hash_hit is not None:
        matched_id, payload = hash_hit
        return "same_hash", matched_id, payload
    return None


async def download_video(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(follow_redirects=True, timeout=120.0) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()

            def write_chunk(data: bytes) -> None:
                with dest.open("ab") as f:
                    f.write(data)

            if dest.is_file():
                dest.unlink()
            async for chunk in resp.aiter_bytes():
                await asyncio.to_thread(write_chunk, chunk)


async def ensure_video_downloaded(video_url: str, video_path: Path) -> None:
    if video_path.is_file():
        return
    await download_video(video_url, video_path)


async def run_annotate_job(
    video_url: str,
    cancel_event: asyncio.Event | None = None,
    video_ready: asyncio.Event | None = None,
) -> dict[str, Any]:
    started_at = time.time()
    duration_sec = random_annotate_duration_sec()
    deadline_at = started_at + duration_sec
    video_id = video_id_from_url(video_url)
    job_id = f"{video_id}-{int(started_at * 1000)}"
    _, _, video_path = cache_paths(video_id)

    sessions = manager.snapshot_online_annotators()
    rank_by_id = manager.ranks_for_sessions(sessions)
    x = len(sessions)
    if x == 0:
        logger.warning("Annotate job skipped: no online annotators")
        return {"predictions": []}

    job = ActiveJob(
        job_id=job_id,
        video_url=video_url,
        video_id=video_id,
        started_at=started_at,
        deadline_at=deadline_at,
        duration_sec=duration_sec,
        segment_total=x,
        rank_by_participant_id=rank_by_id,
    )
    active_jobs[job_id] = job
    job_events[job_id] = []

    logger.info("Annotate job %s started video_id=%s annotators=%d", job_id, video_id, x)

    try:
        return await _run_annotate_job_body(
            video_url,
            job_id=job_id,
            job=job,
            video_id=video_id,
            video_path=video_path,
            deadline_at=deadline_at,
            timing_started_at=started_at,
            cancel_event=cancel_event,
            video_ready=video_ready,
        )
    except asyncio.CancelledError:
        job_events.pop(job_id, None)
        active_jobs.pop(job_id, None)
        logger.info("Annotate job %s cancelled (duplicate cache hit)", job_id)
        raise
    finally:
        if video_ready and not video_ready.is_set():
            video_ready.set()


async def _run_annotate_job_body(
    video_url: str,
    *,
    job_id: str,
    job: ActiveJob,
    video_id: str,
    video_path: Path,
    deadline_at: float,
    timing_started_at: float,
    cancel_event: asyncio.Event | None,
    video_ready: asyncio.Event | None,
) -> dict[str, Any]:
    timing = JobVideoTiming(
        job_id=job_id,
        video_id=video_id,
        annotator_count=job.segment_total,
        api_started_at=timing_started_at,
    )
    global last_annotate_timing

    source_cached = video_path.is_file()
    download_started = time.time()
    await ensure_video_downloaded(video_url, video_path)
    if video_ready:
        video_ready.set()
    if cancel_event and cancel_event.is_set():
        raise asyncio.CancelledError()
    timing.download_sec = time.time() - download_started
    timing.download_cached = source_cached
    timing.download_size_mb = _file_size_mb(video_path)
    _log_job_phase(
        timing,
        "download_original",
        timing.download_sec,
        cached=source_cached,
        path=video_path,
    )

    if cancel_event and cancel_event.is_set():
        raise asyncio.CancelledError()
    if not manager.sync_job_online_annotators(job):
        logger.warning(
            "Annotate job %s: no online annotators at dispatch", job_id
        )
        job_events.pop(job_id, None)
        active_jobs.pop(job_id, None)
        return {"predictions": []}
    dispatch_started = time.time()
    await manager.dispatch_annotate_job_videos(job, video_path, timing=timing)
    timing.dispatch_wall_sec = time.time() - dispatch_started
    timing.completed_at = time.time()
    last_annotate_timing = timing
    _log_job_timing_summary(timing)

    remaining = deadline_at - time.time()
    while remaining > 0:
        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError()
        await asyncio.sleep(min(0.25, remaining))
        remaining = deadline_at - time.time()

    events = sorted(job_events.pop(job_id, []), key=lambda e: e["time_sec"])
    active_jobs.pop(job_id, None)

    payload = await asyncio.to_thread(
        persist_video_annotations,
        video_id=video_id,
        video_url=video_url,
        video_path=video_path,
        events=events,
    )
    await manager.notify_reviewers_video_saved(video_id)
    cleanup_segment_videos(video_id)
    return {"predictions": payload["predictions"]}


async def wait_cache_hit_response_delay(request_started_at: float) -> float:
    """Wait until a random configured delay has elapsed since API request start."""
    target_sec = random.uniform(
        CACHE_HIT_RESPONSE_DELAY_MIN_SEC,
        CACHE_HIT_RESPONSE_DELAY_MAX_SEC,
    )
    remaining = target_sec - (time.time() - request_started_at)
    if remaining > 0:
        await asyncio.sleep(remaining)
    return target_sec


async def run_annotate_with_dedup(video_url: str) -> tuple[dict[str, Any], str | None]:
    """Run a fresh annotate job; cancel and return cache if duplicate found in parallel."""
    request_started_at = time.time()
    video_id = video_id_from_url(video_url)

    same_id_payload = lookup_cached_by_video_id(video_id)
    if same_id_payload is not None:
        await manager.notify_duplicate_cache_hit(
            requested_video_id=video_id,
            matched_video_id=video_id,
            reason="same_id",
        )
        await wait_cache_hit_response_delay(request_started_at)
        logger.info(
            "Annotate cache hit (same id) url=%s elapsed=%.2fs",
            video_url,
            time.time() - request_started_at,
        )
        return same_id_payload, "same_id"

    cancel_event = asyncio.Event()
    video_ready = asyncio.Event()

    dup_task = asyncio.create_task(
        probe_duplicate_annotations(video_url, video_id, video_ready=video_ready)
    )
    job_task = asyncio.create_task(
        run_annotate_job(video_url, cancel_event, video_ready)
    )

    try:
        while not job_task.done():
            if dup_task.done():
                dup = dup_task.result()
                if dup is not None:
                    reason, matched_id, payload = dup
                    cancel_event.set()
                    job_task.cancel()
                    try:
                        await job_task
                    except asyncio.CancelledError:
                        pass
                    await manager.notify_duplicate_cache_hit(
                        requested_video_id=video_id,
                        matched_video_id=matched_id,
                        reason=reason,
                    )
                    target_delay_sec = await wait_cache_hit_response_delay(request_started_at)
                    logger.info(
                        "Annotate cache hit url=%s reason=%s matched=%s target_delay_sec=%.2f elapsed=%.2fs",
                        video_url,
                        reason,
                        matched_id,
                        target_delay_sec,
                        time.time() - request_started_at,
                    )
                    return payload, reason
            await asyncio.sleep(0.05)

        if not dup_task.done():
            dup_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await dup_task

        return await job_task, None
    except Exception:
        if not job_task.done():
            job_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await job_task
        if not dup_task.done():
            dup_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await dup_task
        raise


async def run_test_round() -> None:
    videos = _list_videos_data()
    if not videos or manager.test_annotator_count == 0:
        manager.schedule_next_test_round()
        await manager.broadcast_test_schedule()
        return

    with_url = [v for v in videos if v.get("video_url")]
    if not with_url:
        manager.schedule_next_test_round()
        await manager.broadcast_test_schedule()
        return

    item = random.choice(with_url)
    video_id = item["video_id"]
    remote_url = item["video_url"]
    job_id = f"test-{video_id}-{int(time.time() * 1000)}"
    active_test_jobs.add(job_id)
    test_job_events[job_id] = []

    sessions = manager.snapshot_online_test_annotators()
    if not sessions:
        active_test_jobs.discard(job_id)
        test_job_events.pop(job_id, None)
        manager.schedule_next_test_round()
        await manager.broadcast_test_schedule()
        return

    rank_by_id = manager.ranks_for_sessions(sessions)
    state = TestJobState(
        job_id=job_id,
        video_id=video_id,
        video_url=remote_url,
        segment_total=len(sessions),
        rank_by_participant_id=rank_by_id,
    )
    test_job_states[job_id] = state
    video_path = VIDEOS_DIR / f"{video_id}.mp4"
    if remote_url:
        try:
            await ensure_video_downloaded(remote_url, video_path)
        except httpx.HTTPError:
            logger.exception("Test video download failed for %s", remote_url)
            active_test_jobs.discard(job_id)
            test_job_events.pop(job_id, None)
            test_job_states.pop(job_id, None)
            manager.schedule_next_test_round()
            await manager.broadcast_test_schedule()
            return

    if not video_path.is_file():
        logger.warning("Test job %s skipped — no local video for id %s", job_id, video_id)
        active_test_jobs.discard(job_id)
        test_job_events.pop(job_id, None)
        test_job_states.pop(job_id, None)
        manager.schedule_next_test_round()
        await manager.broadcast_test_schedule()
        return

    test_duration_sec = random_annotate_duration_sec()
    test_deadline = time.time() + test_duration_sec
    try:
        logger.info("Test job %s: %d users", job_id, state.segment_total)
        await manager.broadcast_test_job(
            state, deadline_at=test_deadline, duration_sec=test_duration_sec
        )
        remaining = test_deadline - time.time()
        if remaining > 0:
            await asyncio.sleep(remaining)
    finally:
        active_test_jobs.discard(job_id)
        test_job_events.pop(job_id, None)
        test_job_states.pop(job_id, None)

    manager.schedule_next_test_round()
    await manager.broadcast_test_schedule()


async def _test_scheduler_loop() -> None:
    manager.schedule_next_test_round()
    await manager.broadcast_test_schedule()
    while True:
        if manager._next_test_round_at is None:
            manager.schedule_next_test_round()
        wait = max(0.0, manager._next_test_round_at - time.time())
        await asyncio.sleep(wait)
        try:
            await run_test_round()
        except Exception:
            logger.exception("Test round failed")
            manager.schedule_next_test_round()
            await manager.broadcast_test_schedule()


async def _session_maintenance_loop() -> None:
    while True:
        await asyncio.sleep(300)
        purge_expired_sessions()


async def _api_schedule_broadcast_loop() -> None:
    schedule_next_api_call()
    await manager.broadcast_api_schedule()
    while True:
        await asyncio.sleep(1)
        await manager.broadcast_api_schedule()


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    validate_startup_config()
    ensure_data_dirs()
    test_task = asyncio.create_task(_test_scheduler_loop())
    api_schedule_task = asyncio.create_task(_api_schedule_broadcast_loop())
    session_task = asyncio.create_task(_session_maintenance_loop())
    yield
    for task in (test_task, api_schedule_task, session_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Soccer Annotator API", lifespan=lifespan)

_STATIC_CACHE_PATHS = frozenset({"/app.js", "/login.js", "/home.js", "/styles.css"})


@app.middleware("http")
async def security_and_cache_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path in _STATIC_CACHE_PATHS:
        response.headers["Cache-Control"] = "public, max-age=3600"
    return response


@app.middleware("http")
async def redirect_unauthenticated_browser(request: Request, call_next):
    if request.method == "GET" and _is_browser_page_path(request.url.path):
        if not _is_authenticated(request):
            return _login_redirect()
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> Response:
    if exc.status_code == 401 and _should_redirect_unauthenticated(request):
        return _login_redirect()
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.post("/api/large_model_processing")
async def annotate(
    body: AnnotateRequest,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> JSONResponse:
    if not verify_api_key(x_api_key):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")
    video_url = str(body.video_url)

    try:
        video_id_from_url(video_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    api_started_at = time.time()
    video_id = video_id_from_url(video_url)
    logger.info("Annotate API request received url=%s", video_url)
    await manager.notify_api_call_started(video_id)

    fallback_reason = None
    if manager.annotator_count == 0:
        fallback_reason = "no annotators connected"
    elif manager.online_annotator_count == 0:
        fallback_reason = "no online annotators available"

    if fallback_reason:
        try:
            result = await generate_random_annotation_fallback(video_url)
        except httpx.HTTPError as exc:
            logger.exception("Random fallback annotation failed")
            raise HTTPException(status_code=502, detail=f"Request failed: {exc}") from exc
        logger.info(
            "Annotate API random fallback ready url=%s elapsed_since_request=%.2fs reason=%s",
            video_url,
            _elapsed_since(api_started_at),
            fallback_reason,
        )
        return JSONResponse(content=result)

    try:
        result, cache_reason = await run_annotate_with_dedup(video_url)
    except httpx.HTTPError as exc:
        logger.exception("Annotate job failed")
        raise HTTPException(status_code=502, detail=f"Request failed: {exc}") from exc

    logger.info(
        "Annotate API response ready url=%s cache=%s elapsed_since_request=%.2fs",
        video_url,
        cache_reason or "fresh",
        _elapsed_since(api_started_at),
    )
    headers = {"X-Annotation-Cache": cache_reason} if cache_reason else None
    return JSONResponse(content=result, headers=headers)


def _list_videos_data() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for meta_file in ANNOTATIONS_DIR.glob("*.meta.json"):
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        vid = meta.get("video_id")
        if not vid:
            continue
        events_file = ANNOTATIONS_DIR / f"{vid}.json"
        event_count = 0
        labelers: dict[str, str] = dict(meta.get("labelers") or {})
        if events_file.is_file():
            data = json.loads(events_file.read_text(encoding="utf-8"))
            event_count = len(
                data.get("events", data.get("predictions", []))
            )
            if not labelers:
                labelers = dict(data.get("labelers") or {})
        labeler_names = sorted(set(labelers.values()))
        items.append(
            {
                "video_id": vid,
                "video_url": meta.get("video_url"),
                "saved_at": meta.get("saved_at"),
                "event_count": event_count,
                "labelers": labelers,
                "labeler_names": labeler_names,
                "video_file": public_video_path(vid),
                "annotations_file": f"/api/videos/{vid}/annotations",
            }
        )
    items.sort(key=lambda item: float(item.get("saved_at") or 0), reverse=True)
    return items


@app.get("/api/health")
async def health() -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "ok",
        "annotators_connected": manager.annotator_count,
        "online_annotators_connected": manager.online_annotator_count,
        "participants_connected": manager.participant_count,
        "test_annotators_connected": manager.test_annotator_count,
        "annotator_access": [
            annotator_access_payload(session)
            for session in manager.snapshot_participants()
        ],
        "next_api_call_at": _next_api_call_at,
        "next_api_seconds_left": api_seconds_left(),
        "api_call_interval_sec": API_CALL_INTERVAL_SEC,
    }
    if last_annotate_timing is not None:
        payload["last_job_video_timing"] = last_annotate_timing.to_dict()
    return payload


@app.post("/api/auth/login")
async def auth_login(body: LoginRequest) -> JSONResponse:
    user_id = body.user_id.strip()
    print(f"[login] attempt user_id={user_id!r} password_len={len(body.password)}")
    if not static_users_configured():
        print("[login] rejected: static users not configured")
        raise HTTPException(status_code=503, detail="Login is not configured on this server")
    if not verify_user_credentials(body.user_id, body.password):
        print(f"[login] failed invalid credentials user_id={user_id!r}")
        raise HTTPException(status_code=401, detail="Invalid user ID or password")
    await manager.disconnect_user(user_id)
    token = create_session(user_id)
    print(f"[login] success user_id={user_id!r}")
    response = JSONResponse(content={"ok": True, "user_id": user_id})
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        max_age=SESSION_TTL_SEC,
        **auth_cookie_params(),
    )
    return response


@app.post("/api/auth/logout")
async def auth_logout(request: Request) -> JSONResponse:
    revoke_session(_auth_token(request))
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(AUTH_COOKIE_NAME, **auth_cookie_params())
    return response


@app.get("/api/auth/status")
async def auth_status(request: Request) -> dict[str, Any]:
    token = _auth_token(request)
    user_id = get_session_user_id(token)
    return {"authenticated": user_id is not None, "user_id": user_id}


@app.get("/api/videos")
async def list_videos(request: Request) -> list[dict[str, Any]]:
    _require_auth(request)
    return _list_videos_data()


@app.get("/api/video/{video_id}")
async def get_public_video(video_id: str) -> FileResponse:
    if not safe_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid video id")
    path = VIDEOS_DIR / f"{video_id}.mp4"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/videos/{video_id}/file")
async def get_video_file_legacy(video_id: str) -> RedirectResponse:
    return RedirectResponse(url=public_video_path(video_id), status_code=307)


@app.get("/api/videos/{video_id}/annotations")
async def get_annotations(video_id: str, request: Request) -> dict[str, Any]:
    _require_auth(request)
    if not safe_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid video id")
    path = ANNOTATIONS_DIR / f"{video_id}.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Annotations not found")
    data = json.loads(path.read_text(encoding="utf-8"))
    return annotations_detail_payload(data)


@app.get("/api/labels")
async def get_labels(request: Request) -> dict[str, Any]:
    _require_auth(request)
    return labels_api_payload()


@app.post("/api/auth/verify")
async def auth_verify_legacy(body: LoginRequest) -> JSONResponse:
    """Deprecated alias for POST /api/auth/login."""
    return await auth_login(body)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    if not verify_session(websocket.cookies.get(AUTH_COOKIE_NAME)):
        await websocket.accept()
        await websocket.close(code=1008, reason="Not authenticated")
        return
    await websocket.accept()
    manager.connections.add(websocket)
    role: str | None = None
    participant_session: AnnotatorSession | None = None
    session_user_id = get_session_user_id(
        websocket.cookies.get(AUTH_COOKIE_NAME)
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg_type = data.get("type")

            if msg_type == "set_role":
                if role is not None:
                    await manager.leave_role(websocket)
                    participant_session = None
                role = data.get("role")
                if role == "annotator":
                    participant_session = await manager.register_annotator(
                        websocket, user_id=session_user_id
                    )
                    rank = manager.rank_of_participant(participant_session.annotator_id)
                    x = manager.annotator_count
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "role_ack",
                                "role": "annotator",
                                "annotator_id": participant_session.annotator_id,
                                "annotator_index": rank,
                                "annotator_total": x,
                                "online": participant_session.online,
                                "presence_idle_minutes": PRESENCE_IDLE_MINUTES,
                                "segment_window_sec": SEGMENT_WINDOW_SEC,
                                **playback_timing_for_rank(rank, x),
                            }
                        )
                    )
                    await manager.send_annotator_roster(websocket)
                    if active_jobs:
                        await manager.send_active_annotate_job(participant_session)
                    else:
                        await manager.send_api_schedule(websocket)
                elif role == "reviewer":
                    participant_session = await manager.register_reviewer(
                        websocket, user_id=session_user_id
                    )
                    rank = manager.rank_of_participant(participant_session.annotator_id)
                    x = manager.annotator_count
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "role_ack",
                                "role": "reviewer",
                                "videos": _list_videos_data(),
                                "annotator_id": participant_session.annotator_id,
                                "annotator_index": rank,
                                "annotator_total": x,
                                "start_offset_sec": manager.start_offset_for(
                                    rank, total=x
                                ),
                            }
                        )
                    )
                    await manager.send_annotator_roster(websocket)
                elif role == "test":
                    participant_session = await manager.register_test_annotator(
                        websocket, user_id=session_user_id
                    )
                    rank = manager.rank_of_participant(participant_session.annotator_id)
                    x = manager.annotator_count
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "role_ack",
                                "role": "test",
                                "annotator_id": participant_session.annotator_id,
                                "annotator_index": rank,
                                "annotator_total": x,
                                "online": participant_session.online,
                                "presence_idle_minutes": PRESENCE_IDLE_MINUTES,
                                "segment_window_sec": SEGMENT_WINDOW_SEC,
                                **playback_timing_for_rank(rank, x),
                            }
                        )
                    )
                    await manager.send_annotator_roster(websocket)
                    await manager.send_test_schedule(websocket)
                continue

            if msg_type == "set_online" and participant_session is not None:
                await manager.set_session_online(
                    participant_session, bool(data.get("online", False))
                )
                continue

            if msg_type == "set_user_idle":
                target_user_id = str(data.get("user_id") or "").strip()
                if target_user_id:
                    await manager.set_user_online(target_user_id, False)
                continue

            if msg_type == "annotation" and role == "test":
                if participant_session and not participant_session.online:
                    continue
                job_id = data.get("job_id")
                label = data.get("label")
                time_sec = data.get("time_sec")
                frame = data.get("frame")
                if label not in LABEL_IDS or job_id not in active_test_jobs:
                    continue
                pid = participant_session.annotator_id if participant_session else 0
                event = {
                    "time_sec": round(float(time_sec), 2),
                    "label": label,
                    "frame": int(frame) if frame is not None else None,
                    "participant_id": pid,
                    "user_id": participant_session.user_id if participant_session else None,
                    "uid": f"p{pid}-{round(float(time_sec), 2)}-{label}",
                }
                test_job_events.setdefault(job_id, []).append(event)
                await manager.broadcast_job_event(
                    job_id, event, "add", test_only=True
                )
                continue

            if msg_type == "annotation" and role in ("annotator", "reviewer"):
                if participant_session and not participant_session.online:
                    continue
                job_id = data.get("job_id")
                label = data.get("label")
                time_sec = data.get("time_sec")
                frame = data.get("frame")
                if label not in LABEL_IDS or job_id not in job_events:
                    continue
                pid = participant_session.annotator_id if participant_session else 0
                event = {
                    "time_sec": round(float(time_sec), 2),
                    "label": label,
                    "frame": int(frame) if frame is not None else None,
                    "participant_id": pid,
                    "user_id": participant_session.user_id if participant_session else None,
                    "uid": f"p{pid}-{round(float(time_sec), 2)}-{label}",
                }
                job_events[job_id].append(event)
                await manager.broadcast_job_event(job_id, event, "add")
                continue

            if msg_type == "annotation_remove" and role in (
                "annotator",
                "test",
                "reviewer",
            ):
                job_id = data.get("job_id")
                label = data.get("label")
                time_sec = data.get("time_sec")
                uid = data.get("uid")
                if label not in LABEL_IDS or not job_id:
                    continue
                pid = participant_session.annotator_id if participant_session else 0
                if role == "test":
                    if job_id in test_job_events:
                        _remove_annotation_event(
                            test_job_events[job_id], time_sec, label
                        )
                    await manager.broadcast_job_event(
                        job_id,
                        {
                            "time_sec": round(float(time_sec), 2),
                            "label": label,
                            "participant_id": pid,
                            "uid": uid,
                        },
                        "remove",
                        test_only=True,
                    )
                elif job_id in job_events:
                    _remove_annotation_event(job_events[job_id], time_sec, label)
                    await manager.broadcast_job_event(
                        job_id,
                        {
                            "time_sec": round(float(time_sec), 2),
                            "label": label,
                            "participant_id": pid,
                            "uid": uid,
                        },
                        "remove",
                    )
                continue

            if msg_type == "set_practice_mode" and role == "test" and participant_session:
                mode = data.get("mode", "sync")
                if mode not in ("sync", "private"):
                    mode = "sync"
                participant_session.practice_mode = mode
                await websocket.send_text(
                    json.dumps({"type": "practice_mode_ack", "mode": mode})
                )
                if mode == "sync":
                    await manager.send_test_schedule(websocket)
                continue

            if msg_type == "list_videos" and role in ("reviewer", "test"):
                await websocket.send_text(
                    json.dumps(
                        {"type": "videos_list", "videos": _list_videos_data()}
                    )
                )

    except WebSocketDisconnect:
        pass
    finally:
        manager.connections.discard(websocket)
        await manager.leave_role(websocket)


def _static_file(name: str) -> FileResponse:
    path = STATIC_DIR / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    media = "text/css" if name.endswith(".css") else "application/javascript"
    if name.endswith(".html"):
        media = "text/html"
    return FileResponse(path, media_type=media)


@app.get("/favicon.ico")
async def serve_favicon() -> Response:
    return Response(status_code=204)


def _serve_login_page() -> FileResponse:
    if not static_users_configured():
        raise HTTPException(status_code=503, detail="Login is not configured on this server")
    return _static_file("login.html")


@app.get("/")
async def serve_home(request: Request) -> Response:
    if not _is_authenticated(request):
        return _login_redirect()
    return _static_file("home.html")


@app.get("/login")
async def serve_login(request: Request) -> Response:
    if _is_authenticated(request):
        return RedirectResponse(url="/", status_code=302)
    return _serve_login_page()


@app.get("/annotator")
@app.get("/annotator/")
async def serve_annotator(request: Request) -> Response:
    if not _is_authenticated(request):
        return _login_redirect()
    return _static_file("annotator.html")


@app.get("/board")
@app.get("/board/")
async def serve_board(request: Request) -> Response:
    if not _is_authenticated(request):
        return _login_redirect()
    return _static_file("board.html")


@app.get("/review")
@app.get("/review/")
async def redirect_review_to_board() -> RedirectResponse:
    return RedirectResponse(url="/board", status_code=301)


@app.get("/practice")
@app.get("/practice/")
async def serve_practice(request: Request) -> Response:
    if not _is_authenticated(request):
        return _login_redirect()
    return _static_file("practice.html")


@app.get("/train")
@app.get("/train/")
async def redirect_train_to_practice() -> RedirectResponse:
    return RedirectResponse(url="/practice", status_code=301)


@app.get("/app")
@app.get("/app/")
async def redirect_legacy_app() -> RedirectResponse:
    return RedirectResponse(url="/annotator", status_code=301)


@app.get("/app/test")
@app.get("/app/test/")
async def redirect_legacy_test() -> RedirectResponse:
    return RedirectResponse(url="/practice", status_code=301)


@app.get("/app.js")
async def serve_app_js() -> FileResponse:
    return _static_file("app.js")


@app.get("/polyfills.js")
async def serve_polyfills_js() -> FileResponse:
    return _static_file("polyfills.js")


@app.get("/login.js")
async def serve_login_js() -> FileResponse:
    return _static_file("login.js")


@app.get("/home.js")
async def serve_home_js() -> FileResponse:
    return _static_file("home.js")


@app.get("/styles.css")
async def serve_styles() -> FileResponse:
    return _static_file("styles.css")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8080"))
    reload = os.getenv("ANNOTATOR_RELOAD", "").lower() in ("1", "true", "yes")
    uvicorn.run(
        "server:app",
        host=host,
        port=port,
        reload=reload,
        reload_excludes=["data/*", "data/**"],
    )
