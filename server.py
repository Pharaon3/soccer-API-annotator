"""Soccer video annotator API and web UI."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import random
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field, HttpUrl

from auth import (
    APP_PASSWORD_HASH,
    AUTH_COOKIE_NAME,
    create_session,
    revoke_session,
    verify_api_key,
    verify_password_hash,
    verify_password_plain,
    verify_session,
)

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

for d in (VIDEOS_DIR, ANNOTATIONS_DIR, STATIC_DIR):
    d.mkdir(parents=True, exist_ok=True)

LABELS = [
    "pass",
    "pass_received",
    "recovery",
    "tackle",
    "interception",
    "ball_out_of_play",
    "clearance",
    "take_on",
    "substitution",
    "block",
    "aerial_duel",
    "shot",
    "save",
    "foul",
    "goal",
]

ANNOTATE_DURATION_SEC = 22
CACHE_DELAY_MIN_SEC = 10
CACHE_DELAY_MAX_SEC = 15
SEGMENT_WINDOW_SEC = 30
TEST_INTERVAL_SEC = 30
VIDEO_WS_CHUNK_SIZE = 256 * 1024


def segment_start_sec(rank: int, total: int) -> float:
    x = max(total, 1)
    return SEGMENT_WINDOW_SEC / x * (rank - 1)


def segment_end_sec(rank: int, total: int) -> float:
    return segment_start_sec(rank, total) + SEGMENT_WINDOW_SEC / max(total, 1)


def segment_duration_sec(rank: int, total: int) -> float:
    return segment_end_sec(rank, total) - segment_start_sec(rank, total)


def url_key(video_url: str) -> str:
    return hashlib.sha256(video_url.encode()).hexdigest()[:16]


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


@dataclass
class ActiveJob:
    job_id: str
    video_url: str
    video_key: str
    started_at: float
    segment_total: int = 1
    rank_by_participant_id: dict[int, int] = field(default_factory=dict)


@dataclass
class TestJobState:
    job_id: str
    video_key: str
    video_url: str
    segment_total: int
    rank_by_participant_id: dict[int, int]


class AnnotateRequest(BaseModel):
    video_url: HttpUrl


class VerifyHashRequest(BaseModel):
    password_hash: str | None = Field(default=None, min_length=64, max_length=64)
    password: str | None = Field(default=None, min_length=1, max_length=256)


def _auth_token(request: Request) -> str | None:
    return request.cookies.get(AUTH_COOKIE_NAME)


def _require_auth(request: Request) -> str:
    token = _auth_token(request)
    if not verify_session(token):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return token or ""


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
        return len(self.participants)

    @property
    def test_annotator_count(self) -> int:
        return len(self.test_annotators)

    def _new_participant(self, ws: WebSocket) -> AnnotatorSession:
        self._next_participant_id += 1
        session = AnnotatorSession(
            websocket=ws, annotator_id=self._next_participant_id
        )
        self.participants[session.annotator_id] = session
        return session

    def schedule_next_test_round(self, at: float | None = None) -> float:
        if at is None:
            now = time.time()
            at = now + (TEST_INTERVAL_SEC - (now % TEST_INTERVAL_SEC))
        self._next_test_round_at = at
        return at

    async def register_annotator(self, ws: WebSocket) -> AnnotatorSession:
        session = self._new_participant(ws)
        self.annotators[session.annotator_id] = session
        await self._broadcast_annotator_count()
        return session

    async def register_test_annotator(self, ws: WebSocket) -> AnnotatorSession:
        session = self._new_participant(ws)
        self.test_annotators[session.annotator_id] = session
        await self._broadcast_annotator_count()
        return session

    async def register_reviewer(self, ws: WebSocket) -> AnnotatorSession:
        session = self._new_participant(ws)
        self.reviewers.add(ws)
        await self._broadcast_annotator_count()
        return session

    async def send_test_schedule(self, ws: WebSocket) -> None:
        if self._next_test_round_at is None:
            self.schedule_next_test_round()
        await ws.send_text(
            json.dumps(
                {
                    "type": "test_schedule",
                    "next_round_at": self._next_test_round_at,
                    "interval_sec": TEST_INTERVAL_SEC,
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
                "interval_sec": TEST_INTERVAL_SEC,
            }
        )
        dead: list[int] = []
        for aid, session in self.test_annotators.items():
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

    async def _broadcast_annotator_count(self) -> None:
        msg = json.dumps({"type": "annotator_count", "count": self.annotator_count})
        dead: list[int] = []
        for aid, session in self.participants.items():
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

    def snapshot_test_annotators(self) -> list[AnnotatorSession]:
        return sorted(self.test_annotators.values(), key=lambda s: s.annotator_id)

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
        start_offset, seg_end = self.segment_bounds(rank, total=x)
        return {
            "type": "annotate_start",
            "job_id": job.job_id,
            "video_key": job.video_key,
            "video_file": video_file_path(job.video_key),
            "source_url": job.video_url,
            "annotator_id": session.annotator_id,
            "annotator_index": rank,
            "annotator_total": x,
            "start_offset_sec": start_offset,
            "time_origin_sec": start_offset,
            "segment_end_sec": seg_end,
            "clip_duration_sec": segment_duration_sec(rank, x),
            "segment_window_sec": SEGMENT_WINDOW_SEC,
            "duration_sec": ANNOTATE_DURATION_SEC,
        }

    async def broadcast_annotate_job(self, job: ActiveJob, video_path: Path) -> None:
        dead: list[int] = []
        for aid in sorted(job.rank_by_participant_id, key=job.rank_by_participant_id.get):
            rank = job.rank_by_participant_id[aid]
            session = self.participants.get(aid)
            if not session:
                continue
            try:
                await send_video_over_websocket(
                    session.websocket, job.job_id, job.video_key, video_path
                )
                await session.websocket.send_text(
                    json.dumps(self._annotate_start_payload(job, rank, session))
                )
            except Exception:
                dead.append(aid)
        for aid in dead:
            await self._drop_participant(aid)

    async def send_active_annotate_job(
        self, session: AnnotatorSession, video_path: Path
    ) -> None:
        if not active_jobs:
            return
        job_id, job = max(active_jobs.items(), key=lambda item: item[1].started_at)
        rank = job.rank_by_participant_id.get(session.annotator_id)
        if rank is None:
            return
        await send_video_over_websocket(
            session.websocket, job_id, job.video_key, video_path
        )
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
        self, state: TestJobState, rank: int, session: AnnotatorSession
    ) -> dict[str, Any]:
        x = state.segment_total
        start_offset, seg_end = self.segment_bounds(rank, total=x)
        return {
            "type": "test_start",
            "job_id": state.job_id,
            "video_key": state.video_key,
            "duration_sec": ANNOTATE_DURATION_SEC,
            "video_file": video_file_path(state.video_key),
            "source_url": state.video_url,
            "annotator_id": session.annotator_id,
            "annotator_index": rank,
            "annotator_total": x,
            "start_offset_sec": start_offset,
            "time_origin_sec": start_offset,
            "segment_end_sec": seg_end,
            "clip_duration_sec": segment_duration_sec(rank, x),
            "segment_window_sec": SEGMENT_WINDOW_SEC,
        }

    async def broadcast_test_job(self, state: TestJobState, video_path: Path) -> None:
        dead: list[int] = []
        for aid in sorted(
            state.rank_by_participant_id, key=state.rank_by_participant_id.get
        ):
            rank = state.rank_by_participant_id[aid]
            session = self.test_annotators.get(aid)
            if not session:
                continue
            try:
                await send_video_over_websocket(
                    session.websocket, state.job_id, state.video_key, video_path
                )
                await session.websocket.send_text(
                    json.dumps(self._test_start_payload(state, rank, session))
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

    async def notify_reviewers_video_saved(self, video_key: str) -> None:
        del video_key  # broadcast is a simple refresh signal
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


def cache_paths(video_key: str) -> tuple[Path, Path, Path]:
    meta = ANNOTATIONS_DIR / f"{video_key}.meta.json"
    events_file = ANNOTATIONS_DIR / f"{video_key}.json"
    return meta, events_file, VIDEOS_DIR / f"{video_key}.mp4"


def load_cached(video_url: str) -> dict[str, Any] | None:
    key = url_key(video_url)
    _, events_file, _ = cache_paths(key)
    if events_file.is_file():
        return json.loads(events_file.read_text(encoding="utf-8"))
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


def video_file_path(video_key: str) -> str:
    return f"/api/videos/{video_key}/file"


def active_job_video_path() -> Path | None:
    if not active_jobs:
        return None
    job = max(active_jobs.values(), key=lambda j: j.started_at)
    path = VIDEOS_DIR / f"{job.video_key}.mp4"
    return path if path.is_file() else None


async def send_video_over_websocket(
    ws: WebSocket, job_id: str, video_key: str, video_path: Path
) -> None:
    size = video_path.stat().st_size
    await ws.send_text(
        json.dumps(
            {
                "type": "video_transfer_start",
                "job_id": job_id,
                "video_key": video_key,
                "size": size,
                "mime": "video/mp4",
            }
        )
    )

    def iter_chunks() -> Any:
        with video_path.open("rb") as f:
            while chunk := f.read(VIDEO_WS_CHUNK_SIZE):
                yield chunk

    for chunk in iter_chunks():
        await ws.send_bytes(chunk)

    await ws.send_text(
        json.dumps(
            {
                "type": "video_transfer_end",
                "job_id": job_id,
                "video_key": video_key,
            }
        )
    )


async def run_annotate_job(video_url: str) -> dict[str, Any]:
    key = url_key(video_url)
    job_id = f"{key}-{int(time.time() * 1000)}"
    _, _, video_path = cache_paths(key)

    sessions = manager.snapshot_participants()
    rank_by_id = manager.ranks_for_sessions(sessions)
    x = len(sessions)

    job = ActiveJob(
        job_id=job_id,
        video_url=video_url,
        video_key=key,
        started_at=time.time(),
        segment_total=x,
        rank_by_participant_id=rank_by_id,
    )
    active_jobs[job_id] = job
    job_events[job_id] = []

    await ensure_video_downloaded(video_url, video_path)

    logger.info("Annotate job %s: %d users %s", job_id, x, rank_by_id)
    await manager.broadcast_annotate_job(job, video_path)
    await asyncio.sleep(ANNOTATE_DURATION_SEC)

    events = sorted(job_events.pop(job_id, []), key=lambda e: e["time_sec"])
    active_jobs.pop(job_id, None)

    api_events = [{"time_sec": e["time_sec"], "label": e["label"]} for e in events]
    meta, events_file, _ = cache_paths(key)
    events_file.write_text(
        json.dumps({"events": api_events}, indent=2), encoding="utf-8"
    )
    meta.write_text(
        json.dumps(
            {
                "video_url": video_url,
                "video_key": key,
                "saved_at": time.time(),
                "local_file": video_path.name if video_path.is_file() else None,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    await manager.notify_reviewers_video_saved(key)
    return {"events": api_events}


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
    video_key = item["video_key"]
    remote_url = item["video_url"]
    job_id = f"test-{video_key}-{int(time.time() * 1000)}"
    active_test_jobs.add(job_id)
    test_job_events[job_id] = []

    sessions = manager.snapshot_test_annotators()
    if not sessions:
        active_test_jobs.discard(job_id)
        test_job_events.pop(job_id, None)
        manager.schedule_next_test_round()
        await manager.broadcast_test_schedule()
        return

    rank_by_id = manager.ranks_for_sessions(sessions)
    state = TestJobState(
        job_id=job_id,
        video_key=video_key,
        video_url=remote_url,
        segment_total=len(sessions),
        rank_by_participant_id=rank_by_id,
    )
    test_job_states[job_id] = state
    video_path = VIDEOS_DIR / f"{video_key}.mp4"
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
        logger.warning("Test job %s skipped — no local video for key %s", job_id, video_key)
        active_test_jobs.discard(job_id)
        test_job_events.pop(job_id, None)
        test_job_states.pop(job_id, None)
        manager.schedule_next_test_round()
        await manager.broadcast_test_schedule()
        return

    try:
        logger.info("Test job %s: %d users", job_id, state.segment_total)
        await manager.broadcast_test_job(state, video_path)
        await asyncio.sleep(ANNOTATE_DURATION_SEC)
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    if not APP_PASSWORD_HASH:
        logger.warning("APP_PASSWORD_HASH is not set — web login will fail")
    task = asyncio.create_task(_test_scheduler_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Soccer Annotator API", lifespan=lifespan)


@app.post("/api/annotate")
async def annotate(
    body: AnnotateRequest,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> JSONResponse:
    if not verify_api_key(x_api_key):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")
    video_url = str(body.video_url)
    cached = load_cached(video_url)
    if cached is not None:
        delay = random.uniform(CACHE_DELAY_MIN_SEC, CACHE_DELAY_MAX_SEC)
        logger.info("Cached video %s — responding in %.2fs", video_url, delay)
        await asyncio.sleep(delay)
        return JSONResponse(content=cached)

    if manager.annotator_count == 0:
        raise HTTPException(
            status_code=503,
            detail="No annotators connected. Open the web UI first.",
        )

    try:
        result = await run_annotate_job(video_url)
    except httpx.HTTPError as exc:
        logger.exception("Annotate job failed")
        raise HTTPException(status_code=502, detail=f"Request failed: {exc}") from exc

    return JSONResponse(content=result)


def _list_videos_data() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for meta_file in sorted(ANNOTATIONS_DIR.glob("*.meta.json")):
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        key = meta["video_key"]
        events_file = ANNOTATIONS_DIR / f"{key}.json"
        event_count = 0
        if events_file.is_file():
            data = json.loads(events_file.read_text(encoding="utf-8"))
            event_count = len(data.get("events", []))
        items.append(
            {
                "video_key": key,
                "video_url": meta.get("video_url"),
                "saved_at": meta.get("saved_at"),
                "event_count": event_count,
                "video_file": f"/api/videos/{key}/file",
                "annotations_file": f"/api/videos/{key}/annotations",
            }
        )
    return items


@app.post("/api/auth/verify")
async def auth_verify(body: VerifyHashRequest) -> JSONResponse:
    ok = False
    if body.password_hash:
        ok = verify_password_hash(body.password_hash)
    elif body.password:
        ok = verify_password_plain(body.password)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid password")
    token = create_session()
    response = JSONResponse(content={"ok": True})
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
        secure=os.getenv("COOKIE_SECURE", "").lower() in ("1", "true", "yes"),
    )
    return response


@app.post("/api/auth/logout")
async def auth_logout(request: Request) -> JSONResponse:
    revoke_session(_auth_token(request))
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(AUTH_COOKIE_NAME)
    return response


@app.get("/api/auth/status")
async def auth_status(request: Request) -> dict[str, bool]:
    return {"authenticated": verify_session(_auth_token(request))}


@app.get("/api/videos")
async def list_videos(request: Request) -> list[dict[str, Any]]:
    _require_auth(request)
    return _list_videos_data()


@app.get("/api/videos/{video_key}/file")
async def get_video_file(video_key: str, request: Request) -> FileResponse:
    _require_auth(request)
    path = VIDEOS_DIR / f"{video_key}.mp4"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/videos/{video_key}/annotations")
async def get_annotations(video_key: str, request: Request) -> dict[str, Any]:
    _require_auth(request)
    path = ANNOTATIONS_DIR / f"{video_key}.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Annotations not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/labels")
async def get_labels(request: Request) -> list[str]:
    _require_auth(request)
    return LABELS


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    if not verify_session(websocket.cookies.get(AUTH_COOKIE_NAME)):
        await websocket.accept()
        await websocket.close(code=1008, reason="Not authenticated")
        return
    await websocket.accept()
    manager.connections.add(websocket)
    role: str | None = None
    annotator_session: AnnotatorSession | None = None

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "set_role":
                if role is not None:
                    await manager.leave_role(websocket)
                    annotator_session = None
                role = data.get("role")
                if role == "annotator":
                    annotator_session = await manager.register_annotator(websocket)
                    rank = manager.rank_of_participant(annotator_session.annotator_id)
                    x = manager.annotator_count
                    seg_start, seg_end = manager.segment_bounds(rank, total=x)
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "role_ack",
                                "role": "annotator",
                                "annotator_id": annotator_session.annotator_id,
                                "annotator_index": rank,
                                "annotator_total": x,
                                "start_offset_sec": seg_start,
                                "time_origin_sec": seg_start,
                                "segment_end_sec": seg_end,
                                "clip_duration_sec": segment_duration_sec(rank, x),
                                "segment_window_sec": SEGMENT_WINDOW_SEC,
                            }
                        )
                    )
                    active_video_path = active_job_video_path()
                    if active_video_path:
                        await manager.send_active_annotate_job(
                            annotator_session, active_video_path
                        )
                elif role == "reviewer":
                    reviewer_session = await manager.register_reviewer(websocket)
                    rank = manager.rank_of_participant(reviewer_session.annotator_id)
                    x = manager.annotator_count
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "role_ack",
                                "role": "reviewer",
                                "videos": _list_videos_data(),
                                "annotator_id": reviewer_session.annotator_id,
                                "annotator_index": rank,
                                "annotator_total": x,
                                "start_offset_sec": manager.start_offset_for(
                                    rank, total=x
                                ),
                            }
                        )
                    )
                elif role == "test":
                    annotator_session = await manager.register_test_annotator(websocket)
                    rank = manager.rank_of_participant(annotator_session.annotator_id)
                    x = manager.annotator_count
                    seg_start, seg_end = manager.segment_bounds(rank, total=x)
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "role_ack",
                                "role": "test",
                                "annotator_id": annotator_session.annotator_id,
                                "annotator_index": rank,
                                "annotator_total": x,
                                "start_offset_sec": seg_start,
                                "time_origin_sec": seg_start,
                                "segment_end_sec": seg_end,
                                "clip_duration_sec": segment_duration_sec(rank, x),
                                "segment_window_sec": SEGMENT_WINDOW_SEC,
                            }
                        )
                    )
                    await manager.send_test_schedule(websocket)
                continue

            if msg_type == "annotation" and role == "test":
                job_id = data.get("job_id")
                label = data.get("label")
                time_sec = data.get("time_sec")
                if label not in LABELS or job_id not in active_test_jobs:
                    continue
                pid = annotator_session.annotator_id if annotator_session else 0
                event = {
                    "time_sec": round(float(time_sec), 2),
                    "label": label,
                    "participant_id": pid,
                    "uid": f"p{pid}-{round(float(time_sec), 2)}-{label}",
                }
                test_job_events.setdefault(job_id, []).append(event)
                await manager.broadcast_job_event(
                    job_id, event, "add", test_only=True
                )
                continue

            if msg_type == "annotation" and role in ("annotator", "reviewer"):
                job_id = data.get("job_id")
                label = data.get("label")
                time_sec = data.get("time_sec")
                if label not in LABELS or job_id not in job_events:
                    continue
                pid = annotator_session.annotator_id if annotator_session else 0
                event = {
                    "time_sec": round(float(time_sec), 2),
                    "label": label,
                    "participant_id": pid,
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
                if label not in LABELS or not job_id:
                    continue
                pid = annotator_session.annotator_id if annotator_session else 0
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

            if msg_type == "list_videos" and role == "reviewer":
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


def _escape_js_string(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\r", "")
        .replace("\n", "\\n")
        .replace("<", "\\u003c")
    )


def _serve_login_page() -> Response:
    html_path = STATIC_DIR / "login.html"
    if not html_path.is_file():
        raise HTTPException(status_code=404, detail="login.html not found")
    html = html_path.read_text(encoding="utf-8")
    if not APP_PASSWORD_HASH:
        raise HTTPException(status_code=500, detail="APP_PASSWORD_HASH not configured")
    inject = (
        f'<script>window.APP_PASSWORD_HASH="{_escape_js_string(APP_PASSWORD_HASH)}";</script>'
    )
    if "</head>" in html:
        html = html.replace("</head>", f"  {inject}\n</head>", 1)
    else:
        html = inject + html
    return Response(content=html, media_type="text/html")


@app.get("/")
async def serve_root(request: Request) -> Response:
    if verify_session(_auth_token(request)):
        return RedirectResponse(url="/app", status_code=302)
    return _serve_login_page()


@app.get("/app")
async def serve_app(request: Request) -> FileResponse:
    _require_auth(request)
    return _static_file("index.html")


@app.get("/app/test")
async def serve_test_app(request: Request) -> FileResponse:
    _require_auth(request)
    return _static_file("test.html")


@app.get("/app.js")
async def serve_app_js(request: Request) -> FileResponse:
    _require_auth(request)
    return _static_file("app.js")


@app.get("/login.js")
async def serve_login_js() -> FileResponse:
    return _static_file("login.js")


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
