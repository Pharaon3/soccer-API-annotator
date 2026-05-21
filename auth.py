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
SESSION_SECRET = os.getenv("SESSION_SECRET", "")
AUTH_COOKIE_NAME = "annotator_auth"
SESSION_TTL_SEC = 60 * 60 * 24 * 7
_SESSION_PURGE_INTERVAL_SEC = 300
STATIC_USER_SLOTS = 5

_sessions: dict[str, tuple[float, str]] = {}
_last_session_purge = 0.0


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _load_static_users() -> dict[str, str]:
    """Map user id -> password hash from ANNOTATOR_USER_{1..5}_ID and _PASSWORD(_HASH)."""
    users: dict[str, str] = {}
    for index in range(1, STATIC_USER_SLOTS + 1):
        user_id = os.getenv(f"ANNOTATOR_USER_{index}_ID", "").strip()
        if not user_id:
            continue
        password_hash = os.getenv(
            f"ANNOTATOR_USER_{index}_PASSWORD_HASH", ""
        ).strip().lower()
        if not password_hash:
            plain = os.getenv(f"ANNOTATOR_USER_{index}_PASSWORD", "")
            if plain:
                password_hash = hash_password(plain)
        if password_hash:
            users[user_id] = password_hash
    return users


STATIC_USERS: dict[str, str] = _load_static_users()


def static_users_configured() -> bool:
    return bool(STATIC_USERS)


def list_static_user_ids() -> list[str]:
    return sorted(STATIC_USERS.keys())


def auth_cookie_params() -> dict[str, bool | str]:
    secure = os.getenv("COOKIE_SECURE", "").lower() in ("1", "true", "yes")
    return {
        "httponly": True,
        "samesite": "lax",
        "path": "/",
        "secure": secure,
    }


def verify_user_credentials(user_id: str, password: str) -> bool:
    expected_hash = STATIC_USERS.get(user_id.strip())
    if not expected_hash:
        return False
    return secrets.compare_digest(hash_password(password), expected_hash)


def create_session(user_id: str) -> str:
    purge_expired_sessions()
    normalized_user_id = user_id.strip()
    for existing_token, (_, existing_user_id) in list(_sessions.items()):
        if existing_user_id == normalized_user_id:
            _sessions.pop(existing_token, None)
    token = secrets.token_urlsafe(32)
    _sessions[token] = (time.time() + SESSION_TTL_SEC, normalized_user_id)
    return token


def verify_session(token: str | None) -> bool:
    return get_session_user_id(token) is not None


def get_session_user_id(token: str | None) -> str | None:
    if not token:
        return None
    purge_expired_sessions()
    entry = _sessions.get(token)
    if entry is None:
        return None
    expires, user_id = entry
    if expires < time.time():
        _sessions.pop(token, None)
        return None
    return user_id


def revoke_session(token: str | None) -> None:
    if token:
        _sessions.pop(token, None)


def purge_expired_sessions() -> None:
    global _last_session_purge
    now = time.time()
    if now - _last_session_purge < _SESSION_PURGE_INTERVAL_SEC:
        return
    _last_session_purge = now
    expired = [token for token, (exp, _) in _sessions.items() if exp < now]
    for token in expired:
        _sessions.pop(token, None)


def verify_api_key(provided: str | None) -> bool:
    if not API_KEY or not provided:
        return False
    return secrets.compare_digest(provided, API_KEY)


def validate_startup_config() -> None:
    """Log warnings for missing or insecure configuration."""
    if not API_KEY:
        logger.warning("API_KEY is not set — POST /api/large_model_processing will reject requests")
    if not STATIC_USERS:
        logger.warning(
            "No annotator users configured — set ANNOTATOR_USER_1_ID … "
            "ANNOTATOR_USER_5_ID (and passwords) in .env"
        )
    else:
        logger.info("Static annotator users loaded: %s", ", ".join(list_static_user_ids()))
    if not SESSION_SECRET:
        logger.warning("SESSION_SECRET is not set — set a long random value in production")
    elif len(SESSION_SECRET) < 32:
        logger.warning("SESSION_SECRET is short — use at least 32 random characters")

    if os.getenv("ANNOTATOR_ENV", "").lower() == "production":
        missing = [
            name
            for name, value in (
                ("API_KEY", API_KEY),
                ("ANNOTATOR_USER_*", STATIC_USERS),
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
