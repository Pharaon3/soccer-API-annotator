"""API key, password auth, and session cookies."""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
import time
from typing import Any

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

API_KEY = os.getenv("API_KEY", "")
APP_PASSWORD_HASH = os.getenv("APP_PASSWORD_HASH", "").strip().lower()
SESSION_SECRET = os.getenv("SESSION_SECRET", "")
AUTH_COOKIE_NAME = "annotator_auth"
SESSION_TTL_SEC = 60 * 60 * 24 * 7
_SESSION_PURGE_INTERVAL_SEC = 300

_sessions: dict[str, float] = {}
_last_session_purge = 0.0


def auth_cookie_params() -> dict[str, bool | str]:
    secure = os.getenv("COOKIE_SECURE", "").lower() in ("1", "true", "yes")
    return {
        "httponly": True,
        "samesite": "lax",
        "path": "/",
        "secure": secure,
    }


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password_plain(password: str) -> bool:
    if not APP_PASSWORD_HASH:
        return False
    return secrets.compare_digest(hash_password(password), APP_PASSWORD_HASH)


def create_session() -> str:
    purge_expired_sessions()
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time() + SESSION_TTL_SEC
    return token


def verify_session(token: str | None) -> bool:
    if not token:
        return False
    purge_expired_sessions()
    expires = _sessions.get(token)
    if expires is None:
        return False
    if expires < time.time():
        _sessions.pop(token, None)
        return False
    return True


def revoke_session(token: str | None) -> None:
    if token:
        _sessions.pop(token, None)


def purge_expired_sessions() -> None:
    global _last_session_purge
    now = time.time()
    if now - _last_session_purge < _SESSION_PURGE_INTERVAL_SEC:
        return
    _last_session_purge = now
    expired = [token for token, exp in _sessions.items() if exp < now]
    for token in expired:
        _sessions.pop(token, None)


def verify_api_key(provided: str | None) -> bool:
    if not API_KEY or not provided:
        return False
    return secrets.compare_digest(provided, API_KEY)


def validate_startup_config() -> None:
    """Log warnings for missing or insecure configuration."""
    if not API_KEY:
        logger.warning("API_KEY is not set — POST /api/annotate will reject requests")
    if not APP_PASSWORD_HASH:
        logger.warning("APP_PASSWORD_HASH is not set — web login will fail")
    if not SESSION_SECRET:
        logger.warning("SESSION_SECRET is not set — set a long random value in production")
    elif len(SESSION_SECRET) < 32:
        logger.warning("SESSION_SECRET is short — use at least 32 random characters")

    if os.getenv("ANNOTATOR_ENV", "").lower() == "production":
        missing = [
            name
            for name, value in (
                ("API_KEY", API_KEY),
                ("APP_PASSWORD_HASH", APP_PASSWORD_HASH),
                ("SESSION_SECRET", SESSION_SECRET),
            )
            if not value
        ]
        if missing:
            logger.error(
                "ANNOTATOR_ENV=production but required variables are missing: %s",
                ", ".join(missing),
            )
        if os.getenv("COOKIE_SECURE", "").lower() not in ("1", "true", "yes"):
            logger.warning("COOKIE_SECURE is not enabled — required when serving over HTTPS")
