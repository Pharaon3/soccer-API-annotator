"""User accounts, sessions, and admin auth."""

from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

DB_PATH = ROOT / "data" / "users.db"
SESSION_TTL_SEC = 60 * 60 * 24 * 7  # 7 days

API_KEY = os.getenv("API_KEY", "")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-insecure-secret")


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER,
                username TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                expires_at REAL NOT NULL
            );
            """
        )
        conn.commit()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), 120_000
    )
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, hex_hash = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), 120_000
    )
    return secrets.compare_digest(digest.hex(), hex_hash)


def create_user(username: str, password: str) -> dict[str, Any]:
    username = username.strip().lower()
    if len(username) < 3:
        raise ValueError("Username must be at least 3 characters")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters")
    now = time.time()
    with _connect() as conn:
        try:
            cur = conn.execute(
                """
                INSERT INTO users (username, password_hash, status, created_at)
                VALUES (?, ?, 'pending', ?)
                """,
                (username, hash_password(password), now),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Username already exists") from exc
        conn.commit()
        return {
            "id": cur.lastrowid,
            "username": username,
            "status": "pending",
            "created_at": now,
        }


def get_user_by_username(username: str) -> sqlite3.Row | None:
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE username = ?", (username.strip().lower(),)
        ).fetchone()


def get_user_by_id(user_id: int) -> sqlite3.Row | None:
    with _connect() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def list_pending_users() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, username, created_at FROM users
            WHERE status = 'pending' ORDER BY created_at ASC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def set_user_status(user_id: int, status: str) -> dict[str, Any] | None:
    with _connect() as conn:
        conn.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        return None
    return {"id": row["id"], "username": row["username"], "status": row["status"]}


def _make_token() -> str:
    return secrets.token_urlsafe(32)


def create_session(
    *, user_id: int | None, username: str, is_admin: bool = False
) -> str:
    token = _make_token()
    expires = time.time() + SESSION_TTL_SEC
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO sessions (token, user_id, username, is_admin, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token, user_id, username, 1 if is_admin else 0, expires),
        )
        conn.commit()
    return token


def get_session(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE token = ?", (token,)
        ).fetchone()
    if row is None:
        return None
    if row["expires_at"] < time.time():
        delete_session(token)
        return None
    return {
        "token": row["token"],
        "user_id": row["user_id"],
        "username": row["username"],
        "is_admin": bool(row["is_admin"]),
    }


def delete_session(token: str) -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


def login_user(username: str, password: str) -> tuple[str, dict[str, Any]]:
    user = get_user_by_username(username)
    if user is None or not verify_password(password, user["password_hash"]):
        raise ValueError("Invalid username or password")
    if user["status"] == "pending":
        raise ValueError("Account pending admin approval")
    if user["status"] == "rejected":
        raise ValueError("Account was rejected")
    if user["status"] != "approved":
        raise ValueError("Account is not active")
    token = create_session(
        user_id=user["id"], username=user["username"], is_admin=False
    )
    return token, {
        "username": user["username"],
        "status": user["status"],
        "is_admin": False,
    }


def login_admin(username: str, password: str) -> tuple[str, dict[str, Any]]:
    if username != ADMIN_USERNAME or password != ADMIN_PASSWORD:
        raise ValueError("Invalid admin credentials")
    token = create_session(user_id=None, username=ADMIN_USERNAME, is_admin=True)
    return token, {"username": ADMIN_USERNAME, "is_admin": True}


def verify_api_key(provided: str | None) -> bool:
    if not API_KEY:
        return False
    if not provided:
        return False
    return secrets.compare_digest(provided, API_KEY)
