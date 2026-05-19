"""Download source video and cut per-user segments with ffmpeg."""

from __future__ import annotations

import asyncio
import logging
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path
logger = logging.getLogger(__name__)

SEGMENT_WINDOW_SEC = 30


def segment_start_sec(rank: int, total: int) -> float:
    x = max(total, 1)
    return SEGMENT_WINDOW_SEC / x * (rank - 1)


def segment_end_sec(rank: int, total: int) -> float:
    x = max(total, 1)
    return segment_start_sec(rank, total) + SEGMENT_WINDOW_SEC / x


def segment_duration_sec(rank: int, total: int) -> float:
    return segment_end_sec(rank, total) - segment_start_sec(rank, total)


def segment_bounds(rank: int, total: int) -> tuple[float, float]:
    start = segment_start_sec(rank, total)
    return start, segment_end_sec(rank, total)


def segment_api_url(job_id: str, rank: int) -> str:
    return f"/api/jobs/{job_id}/segments/{rank}.mp4"


async def _run_ffmpeg(cmd: list[str]) -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError(
            "ffmpeg is not installed or not on PATH. Install ffmpeg to split videos."
        )
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        detail = stderr.decode(errors="replace")[-2000:]
        raise RuntimeError(f"ffmpeg failed: {detail}")


async def ffmpeg_cut(
    input_path: Path, output_path: Path, start_sec: float, duration_sec: float
) -> None:
    if duration_sec <= 0:
        raise ValueError("Segment duration must be positive")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    copy_cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_sec:.3f}",
        "-i",
        str(input_path),
        "-t",
        f"{duration_sec:.3f}",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    try:
        await _run_ffmpeg(copy_cmd)
    except RuntimeError:
        logger.warning("Stream copy failed for %s; re-encoding", output_path.name)
        await _run_ffmpeg(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{start_sec:.3f}",
                "-i",
                str(input_path),
                "-t",
                f"{duration_sec:.3f}",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
                str(output_path),
            ]
        )


OnSegmentReady = Callable[[int, Path], Awaitable[None]]


async def prepare_job_video_segments(
    job_dir: Path,
    video_url: str,
    total_users: int,
    download_video: Callable[[str, Path], Awaitable[None]],
    *,
    local_source: Path | None = None,
    on_segment_ready: OnSegmentReady | None = None,
) -> dict[int, Path]:
    """Download source, extract 30s window, cut one MP4 per user rank."""
    job_dir.mkdir(parents=True, exist_ok=True)
    source = job_dir / "source.mp4"
    if local_source and local_source.is_file():
        await asyncio.to_thread(shutil.copy2, local_source, source)
    elif not source.is_file():
        await download_video(video_url, source)

    window = job_dir / "window.mp4"
    await ffmpeg_cut(source, window, 0, SEGMENT_WINDOW_SEC)

    total = max(total_users, 1)
    paths: dict[int, Path] = {}

    async def cut_rank(rank: int) -> tuple[int, Path]:
        start, end = segment_bounds(rank, total)
        out = job_dir / f"seg_{rank}.mp4"
        await ffmpeg_cut(window, out, start, end - start)
        return rank, out

    if on_segment_ready:
        for rank in range(1, total + 1):
            r, out = await cut_rank(rank)
            paths[r] = out
            await on_segment_ready(r, out)
        return paths

    results = await asyncio.gather(
        *[cut_rank(rank) for rank in range(1, total + 1)]
    )
    return dict(results)


def cleanup_job_dir(job_dir: Path) -> None:
    if job_dir.is_dir():
        shutil.rmtree(job_dir, ignore_errors=True)
