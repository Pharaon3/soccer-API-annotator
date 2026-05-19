# Soccer Video Annotator

API and web UI for crowd-sourced soccer event annotation on short video clips.

## Features

- **POST `/api/annotate`** — send a public `video_url`; after 22 seconds returns merged JSON `{ "events": [{ "time_sec", "label" }, ...] }`
- **Server-hosted video** — each job downloads the source URL to `data/videos/`, then streams the file to annotators over WebSocket before the job starts
- **Multi-annotator sync** — each user plays their slice of a 30s window from the same cached file
- **Cached responses** — repeat requests for the same URL wait 10–15s, then return stored JSON
- **Web UI** — annotator, practice test (`/app/test`), or reviewer

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
| `SESSION_SECRET` | Random string for session cookies |
| `HOST` | Bind address (default `0.0.0.0`) |
| `PORT` | HTTP port (default `8080`) |
| `COOKIE_SECURE` | Set `true` behind HTTPS |
| `ANNOTATOR_RELOAD` | Set `true` only for local dev (auto-reload) |
| `LOG_LEVEL` | `INFO`, `DEBUG`, etc. |

Generate password hash:

```bash
python -c "import hashlib; print(hashlib.sha256(b'your-password').hexdigest())"
```

## API

```bash
curl -X POST http://localhost:8080/api/annotate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key-from-env" \
  -d '{"video_url": "https://example.com/video.mp4"}'
```

Requires at least one connected annotator (open `/app` and choose **Annotator**).

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

- `data/annotations/{key}.json` — event JSON
- `data/annotations/{key}.meta.json` — source URL metadata
- `data/videos/{key}.mp4` — downloaded copy served to annotators and reviewers

## Production

```bash
export PORT=8080
export COOKIE_SECURE=true
uvicorn server:app --host 0.0.0.0 --port 8080 --workers 1
```

Use a reverse proxy (nginx, Caddy) for HTTPS. WebSocket path: `/ws`.
