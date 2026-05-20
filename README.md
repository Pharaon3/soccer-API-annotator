# Soccer Video Annotator

API and web UI for crowd-sourced soccer event annotation on short video clips.

## Features

- **POST `/api/large_model_processing`** — send a public `video_url`; after 22 seconds returns merged JSON `{ "predictions": [{ "frame", "action", "confidence" }, ...] }` (`confidence` random in 0.6–0.9 per item)
- **Server-hosted video** — video id is the original file name (e.g. `b56717cd…` from `…/b56717cd….mp4`); files live in `data/videos/{id}.mp4`; public playback at `GET /api/video/{id}` (no auth); clients poll every 2s until the file is ready
- **Multi-annotator sync** — each user plays their slice of a 30s window from the same cached file
- **Cached responses** — annotation starts immediately; in parallel the server checks video id and SHA-256 content hash. Duplicates return saved `predictions` after a random **20–22s** delay (same as a fresh round) and notify annotators (`duplicate_cache_hit`); hash is stored in `{id}.meta.json`
- **Web UI** — homepage, annotator (`/annotator`), board (`/board`), or practice (`/practice`)

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/macOS
pip install -r requirements.txt
cp .env.example .env            # edit API_KEY, annotator users, SESSION_SECRET
python server.py
```

Open http://localhost:8080 and log in with a configured user ID and password.

## Environment

| Variable | Description |
|----------|-------------|
| `API_KEY` | Required for `POST /api/large_model_processing` (`X-API-Key` header) |
| `ANNOTATOR_USER_{1..5}_ID` | Login user ID for each static account |
| `ANNOTATOR_USER_{1..5}_PASSWORD` | Plain password (hashed at startup) |
| `ANNOTATOR_USER_{1..5}_PASSWORD_HASH` | Optional SHA-256 hex instead of plain password |
| `SESSION_SECRET` | Long random string (32+ characters) |
| `ANNOTATOR_ENV` | Set to `production` for strict startup validation |
| `HOST` | Bind address (default `0.0.0.0`) |
| `PORT` | HTTP port (default `8080`) |
| `COOKIE_SECURE` | Set `true` behind HTTPS |
| `ANNOTATOR_RELOAD` | Set `true` only for local dev (auto-reload) |
| `LOG_LEVEL` | `INFO`, `DEBUG`, etc. |

Example `.env` users (edit IDs and passwords):

```env
ANNOTATOR_USER_1_ID=alice
ANNOTATOR_USER_1_PASSWORD=secret-for-alice
```

Optional: store a hash instead of plain text:

```bash
python -c "import hashlib; print(hashlib.sha256(b'your-password').hexdigest())"
```

## Routes

| Path | Description |
|------|-------------|
| `/` | Homepage (requires login) |
| `/login` | Login page |
| `/annotator` | Annotator workspace |
| `/board` | Browse saved annotations |
| `/practice` | Practice rounds (twice per minute, random video) |
| `/review` | Redirects to `/board` |
| `/train` | Redirects to `/practice` |
| `/ws` | WebSocket (requires session cookie) |
| `/api/health` | Health check (no auth) |
| `/api/large_model_processing` | Annotation API (`X-API-Key`) |
| `/api/auth/login` | Web login |
| `/api/labels` | Label config (authenticated) |

## API

Public video (no auth): `GET /api/video/{video-id}` — returns the `.mp4` once downloaded.

```bash
curl -X POST http://localhost:8080/api/large_model_processing \
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
| Q | pass |
| W | pass_received |
| E | take_on |
| R | recovery |
| T | tackle |
| A | aerial_duel |
| S | save |
| D | shot |
| F | foul |
| G | goal |
| Z | interception |
| X | substitution |
| C | clearance |
| V | block |
| B | ball_out_of_play |

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
