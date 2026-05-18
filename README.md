# Soccer Video Annotator

API and web UI for crowd-sourced soccer event annotation on short video clips.

## Features

- **POST `/api/annotate`** — send a `video_url`; after 22 seconds returns merged JSON `{ "events": [{ "time_sec", "label" }, ...] }`
- **Cached videos** — repeat requests for the same URL wait a random **10–15 seconds**, then return stored JSON
- **Multi-annotator sync** — annotators split a 30s window; user *y* starts at `30/x * (y-1)` seconds
- **Web UI** — annotator (auto-play, 15 labels, shortcuts, overlay) or reviewer (browse saved results)

## Setup

```bash
cd e:\Soccer\Scripts\annotator
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# Edit .env — set API_KEY, ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET
python server.py
```

## Authentication

- **Sign up** — creates a pending account; an admin must approve before login works.
- **Admin** — log in via “Admin login” using credentials from `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).
- **Web UI** — users log in first, then choose Annotator or Reviewer.

## API key

Send the annotate API key on every `POST /api/annotate` request:

```http
X-API-Key: your-key-from-env
```

Open http://localhost:8000 — choose **Annotator** on each machine/tab that will annotate.

## API

```bash
curl -X POST http://localhost:8000/api/annotate ^
  -H "Content-Type: application/json" ^
  -H "X-API-Key: dev-api-key-change-in-production" ^
  -d "{\"video_url\": \"https://scoredata.me/chunks/8cfe43e516de4ee6bcb77e3716e5e6.mp4\"}"
```

Requires at least one connected annotator. Response after **22 seconds** (first request) or **10–15 seconds** at random (cached URL).

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

- `data/videos/{key}.mp4` — downloaded clips
- `data/annotations/{key}.json` — event JSON
- `data/annotations/{key}.meta.json` — source URL metadata
