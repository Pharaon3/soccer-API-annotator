"""Soccer video annotator API and web UI."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, HttpUrl

import auth as auth_store
from auth import init_db, verify_api_key

logging.basicConfig(level=logging.INFO)
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
RESPONSE_TIMEOUT_SEC = 22


def url_key(video_url: str) -> str:
    return hashlib.sha256(video_url.encode()).hexdigest()[:16]


def safe_filename(name: str) -> str:
    return re.sub(r"[^\w.\-]", "_", name)


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
    local_path: Path
    started_at: float
    events: list[dict[str, Any]] = field(default_factory=list)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class AnnotateRequest(BaseModel):
    video_url: HttpUrl


class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class ConnectionManager:
    def __init__(self) -> None:
        self.annotators: dict[int, AnnotatorSession] = {}
        self.reviewers: set[WebSocket] = set()
        self.admins: set[WebSocket] = set()
        self._next_annotator_id = 0

    @property
    def annotator_count(self) -> int:
        return len(self.annotators)

    async def register_annotator(self, ws: WebSocket) -> AnnotatorSession:
        self._next_annotator_id += 1
        session = AnnotatorSession(websocket=ws, annotator_id=self._next_annotator_id)
        self.annotators[session.annotator_id] = session
        await self._broadcast_annotator_count()
        return session

    async def unregister(self, ws: WebSocket) -> None:
        await self.leave_role(ws)

    async def leave_role(self, ws: WebSocket) -> None:
        to_remove = [
            aid for aid, s in self.annotators.items() if s.websocket is ws
        ]
        for aid in to_remove:
            del self.annotators[aid]
        self.reviewers.discard(ws)
        self.admins.discard(ws)
        if to_remove:
            await self._broadcast_annotator_count()

    def register_admin(self, ws: WebSocket) -> None:
        self.admins.add(ws)

    async def notify_signup_pending(self, user: dict[str, Any]) -> None:
        msg = json.dumps({"type": "signup_pending", "user": user})
        dead: set[WebSocket] = set()
        for ws in self.admins:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.add(ws)
        self.admins -= dead

    async def notify_pending_list_changed(self) -> None:
        pending = auth_store.list_pending_users()
        msg = json.dumps({"type": "pending_list", "users": pending})
        dead: set[WebSocket] = set()
        for ws in self.admins:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.add(ws)
        self.admins -= dead

    async def _broadcast_annotator_count(self) -> None:
        count = self.annotator_count
        msg = json.dumps({"type": "annotator_count", "count": count})
        dead: list[int] = []
        for aid, session in self.annotators.items():
            try:
                await session.websocket.send_text(msg)
            except Exception:
                dead.append(aid)
        for aid in dead:
            del self.annotators[aid]

    def rank_of(self, annotator_id: int) -> int:
        ordered = sorted(self.annotators.keys())
        return ordered.index(annotator_id) + 1

    def start_offset_for(self, annotator_index: int) -> float:
        """annotator_index is 1-based (y)."""
        x = max(self.annotator_count, 1)
        return SEGMENT_WINDOW_SEC / x * (annotator_index - 1)

    async def broadcast_annotate_job(
        self, job: ActiveJob, serve_url: str
    ) -> None:
        x = max(self.annotator_count, 1)
        payload_base = {
            "type": "annotate_start",
            "job_id": job.job_id,
            "video_url": serve_url,
            "original_url": job.video_url,
        }
        dead: list[int] = []
        sorted_sessions = sorted(
            self.annotators.values(), key=lambda s: s.annotator_id
        )
        for rank, session in enumerate(sorted_sessions, start=1):
            start_offset = self.start_offset_for(rank)
            payload = {
                **payload_base,
                "annotator_index": rank,
                "annotator_total": x,
                "start_offset_sec": start_offset,
                "duration_sec": ANNOTATE_DURATION_SEC,
            }
            try:
                await session.websocket.send_text(json.dumps(payload))
            except Exception:
                dead.append(session.annotator_id)
        for aid in dead:
            del self.annotators[aid]

        alert = {
            **payload_base,
            "duration_sec": ANNOTATE_DURATION_SEC,
            "needs_role_switch": True,
        }
        dead_reviewers: set[WebSocket] = set()
        for ws in list(self.reviewers):
            try:
                await ws.send_text(json.dumps(alert))
            except Exception:
                dead_reviewers.add(ws)
        self.reviewers -= dead_reviewers

    async def notify_reviewers_video_saved(self, video_key: str) -> None:
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

init_db()

app = FastAPI(title="Soccer Annotator API")


def _bearer_token(authorization: str | None = Header(None)) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def require_user(authorization: str | None = Header(None)) -> dict[str, Any]:
    token = _bearer_token(authorization)
    session = auth_store.get_session(token or "")
    if session is None or session["is_admin"]:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return session


def require_admin(authorization: str | None = Header(None)) -> dict[str, Any]:
    token = _bearer_token(authorization)
    session = auth_store.get_session(token or "")
    if session is None or not session["is_admin"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    return session


def cache_paths(video_key: str) -> tuple[Path, Path, Path]:
    meta = ANNOTATIONS_DIR / f"{video_key}.meta.json"
    events_file = ANNOTATIONS_DIR / f"{video_key}.json"
    return meta, events_file, VIDEOS_DIR / f"{video_key}.mp4"


def load_cached(video_url: str) -> dict[str, Any] | None:
    key = url_key(video_url)
    _, events_file, video_path = cache_paths(key)
    if events_file.is_file() and video_path.is_file():
        return json.loads(events_file.read_text(encoding="utf-8"))
    return None


def save_cached(video_url: str, events: list[dict[str, Any]], local_video: Path) -> None:
    key = url_key(video_url)
    meta, events_file, dest_video = cache_paths(key)
    if local_video != dest_video and local_video.is_file():
        dest_video.write_bytes(local_video.read_bytes())
    payload = {"events": events}
    events_file.write_text(
        json.dumps(payload, indent=2), encoding="utf-8"
    )
    meta.write_text(
        json.dumps(
            {
                "video_url": video_url,
                "video_key": key,
                "saved_at": time.time(),
                "local_file": dest_video.name,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


async def download_video(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(follow_redirects=True, timeout=120.0) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with dest.open("wb") as f:
                async for chunk in resp.aiter_bytes():
                    f.write(chunk)


async def run_annotate_job(video_url: str) -> dict[str, Any]:
    key = url_key(video_url)
    job_id = f"{key}-{int(time.time() * 1000)}"
    _, _, video_path = cache_paths(key)
    deadline = time.time() + RESPONSE_TIMEOUT_SEC

    job = ActiveJob(
        job_id=job_id,
        video_url=video_url,
        video_key=key,
        local_path=video_path,
        started_at=time.time(),
    )
    active_jobs[job_id] = job
    job_events[job_id] = []

    # Auto-play immediately from remote URL; download for storage in parallel.
    await manager.broadcast_annotate_job(job, video_url)
    download_task = asyncio.create_task(
        _ensure_video_downloaded(video_url, video_path)
    )

    remaining = deadline - time.time()
    if remaining > 0:
        await asyncio.sleep(remaining)

    await download_task

    events = sorted(job_events.get(job_id, []), key=lambda e: e["time_sec"])
    result = {"events": events}
    save_cached(video_url, events, video_path)

    active_jobs.pop(job_id, None)
    job_events.pop(job_id, None)
    await manager.notify_reviewers_video_saved(key)
    return result


async def _ensure_video_downloaded(video_url: str, video_path: Path) -> None:
    if video_path.is_file():
        return
    await download_video(video_url, video_path)


@app.post("/api/auth/signup")
async def signup(body: SignupRequest) -> JSONResponse:
    try:
        user = auth_store.create_user(body.username, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await manager.notify_signup_pending(user)
    return JSONResponse(
        content={
            "message": "Signup received. Wait for admin approval before logging in.",
            "username": user["username"],
            "status": user["status"],
        }
    )


@app.post("/api/auth/login")
async def login(body: LoginRequest) -> JSONResponse:
    try:
        token, profile = auth_store.login_user(body.username, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return JSONResponse(content={"token": token, "user": profile})


async def _admin_login_handler(body: LoginRequest) -> JSONResponse:
    try:
        token, profile = auth_store.login_admin(body.username, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return JSONResponse(content={"token": token, "user": profile})


@app.post("/api/auth/admin/login")
@app.post("/api/auth/admin/login/")
@app.post("/api/admin/login")
async def admin_login(body: LoginRequest) -> JSONResponse:
    return await _admin_login_handler(body)


@app.post("/api/auth/logout")
async def logout(authorization: str | None = Header(None)) -> JSONResponse:
    token = _bearer_token(authorization)
    if token:
        auth_store.delete_session(token)
    return JSONResponse(content={"ok": True})


@app.get("/api/auth/me")
async def me(session: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    user = auth_store.get_user_by_id(session["user_id"])
    return {
        "username": session["username"],
        "is_admin": False,
        "status": user["status"] if user else "approved",
    }


@app.get("/api/auth/admin/me")
async def admin_me(session: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return {"username": session["username"], "is_admin": True}


@app.get("/api/admin/pending")
async def admin_pending(
    _session: dict[str, Any] = Depends(require_admin),
) -> list[dict[str, Any]]:
    return auth_store.list_pending_users()


@app.post("/api/admin/users/{user_id}/approve")
async def approve_user(
    user_id: int, _session: dict[str, Any] = Depends(require_admin)
) -> JSONResponse:
    user = auth_store.set_user_status(user_id, "approved")
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    await manager.notify_pending_list_changed()
    return JSONResponse(content=user)


@app.post("/api/admin/users/{user_id}/reject")
async def reject_user(
    user_id: int, _session: dict[str, Any] = Depends(require_admin)
) -> JSONResponse:
    user = auth_store.set_user_status(user_id, "rejected")
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    await manager.notify_pending_list_changed()
    return JSONResponse(content=user)


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
            detail="No annotators connected. Open the web form as annotator first.",
        )

    try:
        result = await run_annotate_job(video_url)
    except httpx.HTTPError as exc:
        logger.exception("Failed to download video")
        raise HTTPException(status_code=502, detail=f"Video download failed: {exc}") from exc

    return JSONResponse(content=result)


@app.get("/api/videos")
async def list_videos(
    _session: dict[str, Any] = Depends(require_user),
) -> list[dict[str, Any]]:
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


@app.get("/api/videos/{video_key}/file")
async def get_video_file(video_key: str) -> FileResponse:
    path = VIDEOS_DIR / f"{video_key}.mp4"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/videos/{video_key}/annotations")
async def get_annotations(video_key: str) -> dict[str, Any]:
    path = ANNOTATIONS_DIR / f"{video_key}.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Annotations not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/labels")
async def get_labels() -> list[str]:
    return LABELS


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    session: dict[str, Any] | None = None
    role: str | None = None
    annotator_session: AnnotatorSession | None = None

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "auth":
                token = data.get("token", "")
                session = auth_store.get_session(token)
                if session is None:
                    await websocket.send_text(
                        json.dumps({"type": "auth_error", "detail": "Invalid session"})
                    )
                    continue
                if session["is_admin"]:
                    manager.register_admin(websocket)
                    pending = auth_store.list_pending_users()
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "auth_ok",
                                "user": {
                                    "username": session["username"],
                                    "is_admin": True,
                                },
                                "pending_users": pending,
                            }
                        )
                    )
                else:
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "auth_ok",
                                "user": {
                                    "username": session["username"],
                                    "is_admin": False,
                                },
                            }
                        )
                    )
                continue

            if session is None:
                await websocket.send_text(
                    json.dumps({"type": "auth_required"})
                )
                continue

            if msg_type == "set_role":
                if session["is_admin"]:
                    continue
                new_role = data.get("role")
                if role is not None:
                    await manager.leave_role(websocket)
                    annotator_session = None
                role = new_role
                if role == "annotator":
                    annotator_session = await manager.register_annotator(websocket)
                    rank = manager.rank_of(annotator_session.annotator_id)
                    x = manager.annotator_count
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "role_ack",
                                "role": "annotator",
                                "annotator_id": annotator_session.annotator_id,
                                "annotator_index": rank,
                                "annotator_total": x,
                                "start_offset_sec": manager.start_offset_for(rank),
                            }
                        )
                    )
                elif role == "reviewer":
                    manager.reviewers.add(websocket)
                    videos = await list_videos()
                    await websocket.send_text(
                        json.dumps(
                            {"type": "role_ack", "role": "reviewer", "videos": videos}
                        )
                    )
                continue

            if msg_type == "admin_pending" and session["is_admin"]:
                pending = auth_store.list_pending_users()
                await websocket.send_text(
                    json.dumps({"type": "pending_list", "users": pending})
                )
                continue

            if msg_type == "admin_approve" and session["is_admin"]:
                uid = int(data.get("user_id", 0))
                user = auth_store.set_user_status(uid, "approved")
                if user:
                    await manager.notify_pending_list_changed()
                    await websocket.send_text(
                        json.dumps({"type": "user_approved", "user": user})
                    )
                continue

            if msg_type == "admin_reject" and session["is_admin"]:
                uid = int(data.get("user_id", 0))
                user = auth_store.set_user_status(uid, "rejected")
                if user:
                    await manager.notify_pending_list_changed()
                    await websocket.send_text(
                        json.dumps({"type": "user_rejected", "user": user})
                    )
                continue

            if msg_type == "annotation" and role == "annotator":
                job_id = data.get("job_id")
                label = data.get("label")
                time_sec = data.get("time_sec")
                if label not in LABELS:
                    continue
                if job_id not in job_events:
                    continue
                event = {"time_sec": round(float(time_sec), 2), "label": label}
                job_events[job_id].append(event)
                if job_id in active_jobs:
                    async with active_jobs[job_id].lock:
                        active_jobs[job_id].events.append(event)
                continue

            if msg_type == "list_videos" and role == "reviewer":
                videos = await list_videos()
                await websocket.send_text(
                    json.dumps({"type": "videos_list", "videos": videos})
                )

    except WebSocketDisconnect:
        pass
    finally:
        await manager.unregister(websocket)


def _static_file(name: str) -> FileResponse:
    path = STATIC_DIR / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    media = "text/css" if name.endswith(".css") else "application/javascript"
    if name.endswith(".html"):
        media = "text/html"
    return FileResponse(path, media_type=media)


@app.get("/")
async def serve_index() -> FileResponse:
    return _static_file("index.html")


@app.get("/app.js")
async def serve_app_js() -> FileResponse:
    return _static_file("app.js")


@app.get("/styles.css")
async def serve_styles() -> FileResponse:
    return _static_file("styles.css")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8080, reload=True)
