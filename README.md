# Soccer Video Annotator

API and web UI for crowd-sourced soccer event annotation on short video clips.

## Features

- **POST `/api/annotate`** — send a public `video_url`; after 22 seconds returns merged JSON `{ "events": [{ "time_sec", "label" }, ...] }`
- **Server-hosted video** — video id is the original file name (e.g. `b56717cd…` from `…/b56717cd….mp4`); files live in `data/videos/{id}.mp4`; public playback at `GET /api/video/{id}` (no auth); clients poll every 2s until the file is ready
- **Multi-annotator sync** — each user plays their slice of a 30s window from the same cached file
- **Cached responses** — repeat requests for the same URL wait 10–15s, then return stored JSON
- **Web UI** — homepage, annotator (`/annotator`), review (`/review`), or train (`/train`)

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/macOS
pip install -r requirements.txt
cp .env.example .env            # edit API_KEY, APP_PASSWORD_HASH, SESSION_SECRET
python server.py
```

Open http://localhost:8080 and log in with your app password.

## Environment

| Variable | Description |
|----------|-------------|
| `API_KEY` | Required for `POST /api/annotate` (`X-API-Key` header) |
| `APP_PASSWORD_HASH` | SHA-256 hex of the web UI password |
| `SESSION_SECRET` | Long random string (32+ characters) |
| `ANNOTATOR_ENV` | Set to `production` for strict startup validation |
| `HOST` | Bind address (default `0.0.0.0`) |
| `PORT` | HTTP port (default `8080`) |
| `COOKIE_SECURE` | Set `true` behind HTTPS |
| `ANNOTATOR_RELOAD` | Set `true` only for local dev (auto-reload) |
| `LOG_LEVEL` | `INFO`, `DEBUG`, etc. |

Generate password hash:

```bash
python -c "import hashlib; print(hashlib.sha256(b'your-password').hexdigest())"
```

## Routes

| Path | Description |
|------|-------------|
| `/` | Homepage (requires login) |
| `/login` | Login page |
| `/annotator` | Annotator workspace |
| `/review` | Review saved annotations |
| `/train` | Training / practice rounds |
| `/ws` | WebSocket (requires session cookie) |
| `/api/health` | Health check (no auth) |
| `/api/annotate` | Annotation API (`X-API-Key`) |
| `/api/auth/login` | Web login |
| `/api/labels` | Label config (authenticated) |

## API

Public video (no auth): `GET /api/video/{video-id}` — returns the `.mp4` once downloaded.

```bash
curl -X POST http://localhost:8080/api/annotate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key-from-env" \
  -d '{"video_url": "https://example.com/video.mp4"}'
```

Requires at least one connected annotator (open `/annotator`).

Health check:

```bash
curl http://localhost:8080/api/health
```

## Label shortcuts

| Key | Label |
|-----|-------|
| P | pass |
| [ | pass_received |
| R | recovery |
| T | tackle |
| I | interception |
| O | ball_out_of_play |
| C | clearance |
| Y | take_on |
| X | substitution |
| B | block |
| A | aerial_duel |
| S | shot |
| V | save |
| F | foul |
| G | goal |

## Data layout

- `data/annotations/{id}.json` — event JSON
- `data/annotations/{id}.meta.json` — source URL metadata
- `data/videos/{video-id}.mp4` — downloaded copy (id = original file name without `.mp4`)

## Production

```bash
export ANNOTATOR_ENV=production
export COOKIE_SECURE=true
export SESSION_SECRET="$(openssl rand -hex 32)"
uvicorn server:app --host 0.0.0.0 --port 8080 --workers 1
```

Use a reverse proxy (nginx, Caddy) for HTTPS. WebSocket path: `/ws`.

`POST /api/auth/verify` remains as a deprecated alias for `/api/auth/login`.
