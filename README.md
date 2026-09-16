<p align="center"><strong>TANSEN</strong></p>
<p align="center">A full-stack music studio — stream audio, read lyrics, and discover songs by mood.</p>

---

## Overview

Tansen is a three-tier music application. A React client talks to an Express
**API bridge** (search + lyrics) and a Flask **stream engine** (audio URL
resolution), while a Hugging Face–powered **Mood Studio** turns plain-language
feelings into queued tracks.

| Capability | External source | Tooling |
| --- | --- | --- |
| Audio streaming | YouTube | `yt-dlp` (Flask) |
| Song search | YouTube + Genius | `ytsearch5:` · Genius REST API |
| Lyrics | genius.com | `cheerio` scrape of `[data-lyrics-container]` + `lyricsgenius` |
| Mood analysis | Hugging Face Inference API | `distilbert-base-uncased-finetuned-sst-2-english` · `gpt2` |

## Architecture

```
┌────────────┐  /api/search · /api/lyrics   ┌───────────────┐
│            │ ───────────────────────────▶ │  Express API  │ :5001
│   React    │                              │   (bridge)    │
│  + Vite    │  /search · /get-audio-url —▶ │───────────────│
│  :5173     │ ───────────────────────────▶ │  Flask engine │ :5002
│            │  distilbert · gpt2 ────────▶ │──(yt-dlp)─────│
└────────────┘ └──▶ Hugging Face API        └───────────────┘
```

* **Streaming** — the engine runs `ytsearch5:<query>` for results, then
  extracts the direct `.m4a` stream URL for a video id. Media is never
  downloaded; the client's `<audio>` element plays the resolved URL live.
* **Lyrics** — the bridge queries `https://api.genius.com/search`, follows the
  top hit's page and extracts every `[data-lyrics-container]` block into clean
  text. The engine offers the same lookup through `lyricsgenius`.
* **Mood Studio** — user text is classified by DistilBERT sentiment and blended
  with a keyword engine; GPT-2 composes the recommendation narrative, and the
  resulting picks are playable in one click. Without an API key the same flow
  runs fully on the local engine.
* **Offline resilience** — every call degrades gracefully to a built-in demo
  catalogue, so the UI is explorable before any service or key is configured.

## Project layout

```
├── src/                  React 19 client (Vite, Tailwind v4, framer-motion)
│   ├── components/       Player bar, lyrics panel, Mood Studio, views
│   ├── context/          PlayerContext — queue, seek, panels, health checks
│   └── services/         api.ts (search/stream/lyrics) · ai.ts (HF + local mood)
├── server/               Express API bridge (:5001)
│   └── src/
│       ├── controllers/  searchController.js · lyricsController.js
│       └── routes/       api.js
└── python/               Flask stream engine (:5002)
    └── audio_service.py  search · get-audio-url · lyrics
```

## Getting started

### 1 · Stream engine (Python 3.9+)

```bash
cd python
python -m venv .venv && source .venv/bin/activate   # .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env                                 # add GENIUS_ACCESS_TOKEN
python audio_service.py                              # → http://localhost:5002
```

### 2 · API bridge (Node 18+)

```bash
cd server
npm install
cp .env.example .env                                 # add GENIUS_API_KEY
npm run dev                                          # → http://localhost:5001
```

### 3 · Client

```bash
npm install
cp .env.local.example .env.local                     # optionally add HF key
npm run dev                                          # → http://localhost:5173
```

## Environment variables

| File | Variable | Description |
| --- | --- | --- |
| `server/.env` | `PORT` | API bridge port (default `5001`) |
| `server/.env` | `GENIUS_API_KEY` | Genius API key (search + lyrics scrape) |
| `server/.env` | `STREAM_BASE_URL` | Stream engine URL (default `http://localhost:5002`) |
| `python/.env` | `PORT` | Stream engine port (default `5002`) |
| `python/.env` | `GENIUS_ACCESS_TOKEN` | Genius token for `lyricsgenius` |
| `.env.local` | `VITE_API_BASE_URL` | API bridge URL (default `http://localhost:5001`) |
| `.env.local` | `VITE_STREAM_BASE_URL` | Stream engine URL (default `http://localhost:5002`) |
| `.env.local` | `VITE_HUGGING_FACE_API_KEY` | Optional — enables live HF inference in Mood Studio |

## API reference

**Express · :5001**

| Route | Description |
| --- | --- |
| `GET /health` | Heartbeat |
| `GET /api/search?q=` | Track search (yt-dlp via engine → Genius fallback) |
| `GET /api/lyrics?q=` | Lyrics text scraped from the song's Genius page |

**Flask · :5002**

| Route | Description |
| --- | --- |
| `GET /health` | Heartbeat |
| `GET /search?q=` | `ytsearch5:` results (id, title, channel, thumbnail) |
| `GET /get-audio-url/<video_id>` | Direct `.m4a` stream URL |
| `GET /lyrics?query=` | Cleaned lyrics via `lyricsgenius` |

## License

MIT
