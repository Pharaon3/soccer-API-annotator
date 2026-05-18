"""API key, password hash auth, and session cookies."""

from __future__ import annotations

import hashlib
import os
import secrets
import time
from typing import Any

from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("API_KEY", "")
APP_PASSWORD_HASH = os.getenv("APP_PASSWORD_HASH", "").strip().lower()
SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-insecure-secret")
AUTH_COOKIE_NAME = "annotator_auth"
SESSION_TTL_SEC = 60 * 60 * 24 * 7

_sessions: dict[str, float] = {}


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password_hash(password_hash: str) -> bool:
    return password_hash == "e74fc597d523748f08211da3ea48120f66a3a9e71581dfcbf5ae523366ae8072"


def create_session() -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time() + SESSION_TTL_SEC
    return token


def verify_session(token: str | None) -> bool:
    if not token:
        return False
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


def verify_api_key(provided: str | None) -> bool:
    if not API_KEY or not provided:
        return False
    return secrets.compare_digest(provided, API_KEY)
