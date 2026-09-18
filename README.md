<p align="center"><strong>TANSEN</strong></p>
<p align="center">A full-stack music studio — stream audio, read lyrics, and discover songs by mood.</p>

---

## Overview

Tansen is a three-tier music application. A React client talks to an Express
**API bridge** (search, lyrics, and server-side AI intelligence) and a Flask **stream engine** (audio URL
resolution via yt-dlp), while a Hugging Face–powered **Mood Studio** turns plain-language
feelings into queued tracks securely on the server.

| Capability | External source | Tooling |
| --- | --- | --- |
| Audio streaming | YouTube | `yt-dlp` (Flask · Gunicorn) |
| Song search | YouTube | Ranked `yt-dlp` search — variant-filtered |
| Lyrics | LRCLIB · Genius | Confidence-scored matching + `lyricsgenius` + `cheerio` |
| Mood intelligence | Hugging Face | Chat completions via **server-side** Express proxy |

## Architecture

```
┌────────────┐  /api/search · /api/lyrics   ┌───────────────┐
│            │  /api/ai/analyse            │  Express API  │ :5001
│   React    │ ───────────────────────────▶│   (bridge)    │───▶ Hugging Face (server-side)
│  + Vite    │  /api/get-audio-url        │───────────────│
│  :5173     │ ───────────────────────────▶│  Flask engine │ :5002 (yt-dlp)
└────────────┘                              └───────────────┘
```

* **Streaming & search** — the engine searches YouTube (`ytsearch:`), filters
  playlists, karaoke/live/slowed variants the user didn't ask for, ranks by
  title similarity + official-channel signals, and collapses duplicate uploads
  into distinct songs. Direct `.m4a` resolution is a best-effort enhancement;
  the client falls back to the embedded YouTube player.
* **Lyrics** — the bridge extracts the real song identity from noisy YouTube
  titles (quoted titles, `Movie: Song` tails), tries LRCLIB's structured
  exact match (title + artist + duration), scores Genius candidates, then
  scrapes the *selected* Genius page. Every candidate must pass a 0.72
  confidence threshold — wrong lyrics are never shown instead of the truth.
* **Mood Studio** — `POST /api/ai/analyse` runs server-side Hugging Face chat
  completions (multilingual: English, Hindi, Hinglish). The model returns
  structured JSON (mood, emotion, reply, searchQueries); YouTube search
  queries are executed by the backend so tracks are always real. The HF token
  lives only on the server.
* **Security** — Helmet + CSP, origin-restricted CORS, per-endpoint rate
  limits, sanitized health endpoints, honest error codes. No secret is ever
  exposed through `VITE_*` variables.
* **Offline resilience** — every call degrades gracefully to a built-in demo
  catalogue, so the UI is explorable before any service or key is configured.

## Project layout

```
├── src/                  React 19 client (Vite, Tailwind v4, framer-motion)
│   ├── components/       Player bar, lyrics panel, Mood Studio, views
│   ├── context/          PlayerContext — queue, seek, panels, health checks
│   └── services/         api.ts (search/stream/lyrics) · ai.ts (server-backed mood)
├── server/               Express API bridge (:5001)
│   └── src/
│       ├── controllers/  searchController.js · lyricsController.js · aiController.js
│       ├── lib/          rateLimit.js
│       └── routes/       api.js
└── python/               Flask stream engine (:5002)
    └── audio_service.py  search · get-audio-url · lyrics
```

## Getting started

### 1 · Stream engine (Python 3.12 recommended)

```bash
cd python
python -m venv .venv && source .venv/bin/activate   # .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env                                 # add GENIUS_ACCESS_TOKEN
python audio_service.py                              # → http://localhost:5002
```

### 2 · API bridge (Node 20+)

```bash
cd server
npm install
cp .env.example .env                                 # add GENIUS_API_KEY + HF_TOKEN
npm run dev                                          # → http://localhost:5001
```

### 3 · Client

```bash
npm install
cp .env.local.example .env.local                     # dev endpoints only — no secrets
npm run dev                                          # → http://localhost:5173
```

## Production (Render)

Deploy both services from `render.yaml` (New → Blueprint):

| Service | Setting | Value |
| --- | --- | --- |
| **Node** | Build Command | `npm ci && npm run build && npm --prefix server ci --omit=dev` |
| | Start Command | `npm --prefix server start` |
| | Health Check | `/health` |
| **Python** | Root Directory | `python` |
| | Build Command | `pip install --upgrade pip && pip install -r requirements.txt` |
| | Start Command | `gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120 audio_service:app` |
| | Health Check | `/health` |

On the Node service set `STREAM_BASE_URL` to the Python service's public URL
(free tier) or its internal `host:port` over Render private networking (paid).

## Environment variables

| File | Variable | Description |
| --- | --- | --- |
| `server/.env` | `PORT` | API bridge port (default `5001`) |
| `server/.env` | `GENIUS_API_KEY` | Genius key (canonical metadata + lyrics scrape) |
| `server/.env` | `HF_TOKEN` | **Server-only** Hugging Face token for `/api/ai/analyse` |
| `server/.env` | `HF_CHAT_MODEL` | Chat model (default `Qwen/Qwen3-32B:fastest`) |
| `server/.env` | `STREAM_BASE_URL` | Stream engine URL (default `http://localhost:5002`) |
| `server/.env` | `APP_ORIGIN` | Optional explicit CORS origin |
| `python/.env` | `PORT` | Stream engine port (default `5002`) |
| `python/.env` | `GENIUS_ACCESS_TOKEN` | Genius token for `lyricsgenius` |
| `python/.env` | `YOUTUBE_COOKIES` | Base64 Netscape cookies for cloud bot-checks |
| `.env.local` | `VITE_API_BASE_URL` | Dev only (default `http://localhost:5001`) |
| `.env.local` | `VITE_STREAM_BASE_URL` | Dev only (default `http://localhost:5002`) |

> **Never** put secrets in `VITE_*` variables — they are compiled into the public browser bundle.

## API reference

**Express · :5001** (rate-limited)

| Route | Description |
| --- | --- |
| `GET /health` | Heartbeat |
| `GET /api/stream-health` | Stream-engine heartbeat (proxied) |
| `GET /api/search?q=&limit=` | Ranked, variant-filtered YouTube search |
| `GET /api/lyrics?q=&artist=&channel=&duration=` | Confidence-matched lyrics (LRCLIB → Genius) |
| `GET /api/get-audio-url/:videoId` | Direct stream URL (honest 502 on failure) |
| `POST /api/ai/analyse` | Server-side HF mood/chat intelligence |

**Flask · :5002**

| Route | Description |
| --- | --- |
| `GET /health` | Sanitized heartbeat |
| `GET /search?q=&limit=` | Ranked distinct songs (id, title, channel, score) |
| `GET /get-audio-url/<video_id>` | Direct `.m4a` stream URL (best effort) |
| `GET /lyrics?query=` | Cleaned lyrics via `lyricsgenius` |

## License

MIT
