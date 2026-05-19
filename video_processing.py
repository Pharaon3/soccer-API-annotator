"""Download job video to the server for hosting (no transcoding)."""

from __future__ import annotations

import asyncio
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path

SEGMENT_WINDOW_SEC = 30


def job_video_api_url(job_id: str) -> str:
    return f"/api/jobs/{job_id}/video.mp4"


def segment_start_sec(rank: int, total: int) -> float:
    x = max(total, 1)
    return SEGMENT_WINDOW_SEC / x * (rank - 1)


def segment_end_sec(rank: int, total: int) -> float:
    x = max(total, 1)
    return segment_start_sec(rank, total) + SEGMENT_WINDOW_SEC / x


def segment_duration_sec(rank: int, total: int) -> float:
    return segment_end_sec(rank, total) - segment_start_sec(rank, total)


async def download_job_video(
    job_dir: Path,
    video_url: str,
    download_video: Callable[[str, Path], Awaitable[None]],
    *,
    local_source: Path | None = None,
) -> Path:
    """Download (or copy) full source video into the job directory."""
    job_dir.mkdir(parents=True, exist_ok=True)
    dest = job_dir / "video.mp4"
    if local_source and local_source.is_file():
        await asyncio.to_thread(shutil.copy2, local_source, dest)
    elif not dest.is_file():
        await download_video(video_url, dest)
    return dest


def cleanup_job_dir(job_dir: Path) -> None:
    if job_dir.is_dir():
        shutil.rmtree(job_dir, ignore_errors=True)
