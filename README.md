# Tansen

**Stream · Read · Feel**

Tansen is a full-stack, three-tier music application designed for seamless audio streaming, synchronized lyric reading with Romanization, and server-side mood intelligence.

---

## 1. Product Overview

Tansen features a focused, minimal three-state interface:

1. **Minimal Landing Screen**: Fluid entry point with ambient background typography and direct access to Search or Studio mode.
2. **Search & Studio Workspaces**:
   - **Search Workspace**: Rapid query dispatch with debounced input, official-channel ranking, variant filtering (excluding karaoke, slowed, and compilations), and deduplicated song identities.
   - **Studio Workspace**: Server-side Hugging Face conversational assistant that interprets emotions and situations in natural language (English, Hindi, Hinglish) and curates authentic playable tracks.
3. **Immersive Full-Screen Player**: Typographic full-screen playback experience showing the single active timestamped lyric line in sync with the song, Romanized Hindi/Punjabi lyrics, ambient album art color bloom, instrumental gap indicators, and transport controls.

---

## 2. Architecture & Request Flow

```
┌────────────────────────────────────────────────────────┐
│               Frontend (React 19 + Vite)               │
│                     Port: 5173 / SPA                   │
└───────────────────────────┬────────────────────────────┘
                            │
              Same-origin HTTP calls (/api/...)
                            ▼
┌────────────────────────────────────────────────────────┐
│           Express API Bridge (Node.js 22)              │
│                     Port: 5001                         │
│  · Helmet + CSP + CORS    · Rate limiters              │
│  · Lyrics confidence rank · Server-side AI router      │
└─────────────┬───────────────────────────┬──────────────┘
              │                           │
  Server-side axios calls                 │ Server-side POST
              ▼                           ▼
┌───────────────────────────┐   ┌────────────────────────┐
│   Flask Stream Engine     │   │  Hugging Face Router   │
│       (Python 3.12)       │   │ (Qwen / Llama 3.1 API) │
│        Port: 5002         │   │  (HF_TOKEN secret)     │
│  · yt-dlp direct audio    │   └────────────────────────┘
│  · YouTube search net     │
│  · lyricsgenius fallback  │
└───────────────────────────┘
```

### Core Flows

- **Search Flow**:
  - The client queries `GET /api/search?q=<query>`.
  - Express validates query length (2–200 chars) and queries the stream engine.
  - The Python engine pulls candidate video entries via `yt-dlp` (`extract_flat`), filtering out 2-hour jukeboxes, playlists, and non-song snippets.
  - Express scores and ranks the candidates against official channel signals, title similarity, and requested variants.
- **Playback & Autoplay Flow**:
  - Clicking any search result initializes an **autoplay session** (the single clicked track begins playing).
  - The audio engine queries `GET /api/get-audio-url/:videoId`. If `.m4a` direct stream resolution succeeds, audio plays via HTML5 `<audio>`. If datacenter IP restrictions prevent direct stream URL extraction, the player seamlessly falls back to the embedded client-side YouTube player widget, ensuring uninterrupted music.
  - As the song finishes, related tracks are dynamically fetched based on the seed song, artist, and search context, chaining continuous music without looping.
- **Lyrics Matching & LRC Synchronization Flow**:
  - `GET /api/lyrics?q=&artist=&duration=` resolves structured matches via **LRCLIB** first.
  - If unavailable, candidate hits are pulled from Genius, scored against title, artist, and duration, and scraped from the selected Genius lyric page.
  - Any candidate scoring below the **0.72 confidence threshold** is rejected to prevent false matches (e.g., noisy "Tum Hi Ho" queries will never return "Tum Hi Tum Ho" by Rahul Dutta).
  - Synced LRC lines are parsed with offset support and indexed using a binary search algorithm. In the Immersive Player, **only the single active lyric line** is displayed with dynamic typography bloom, while instrumental timestamps render an instrumental pause.
- **Romanization Engine**:
  - A zero-dependency transliterator converts Devanagari and Gurmukhi script lyrics into casual phonetic Roman text (Hinglish / chat style).
  - English lyrics, punctuation, numbers, and Latin characters remain 100% untouched.
- **Studio & Hugging Face Flow**:
  - Prompts are submitted via `POST /api/ai/analyse` to Express.
  - Express formats the prompt and executes server-side inference against Hugging Face.
  - The model returns structured mood and search queries; the backend immediately resolves them into playable tracks.
  - **No Hugging Face token is ever exposed to or bundled in the frontend client.**

---

## 3. Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion, Lucide React.
- **Server API**: Express.js 4, Helmet (CSP configured), CORS, Axios, Cheerio, Express Rate Limit.
- **Stream Engine**: Python 3.12, Flask, Gunicorn, yt-dlp, lyricsgenius, python-dotenv.
- **Testing**: Node.js built-in test runner (`node:test`).

---

## 4. Environment Configuration

### Frontend (`.env.local`)
| Variable | Description | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Express API endpoint (dev only) | `http://localhost:5001` |
| `VITE_STREAM_BASE_URL` | Direct Python engine endpoint (dev fallback) | `http://localhost:5002` |

> [!NOTE]
> In production builds, `VITE_API_BASE_URL` defaults to empty string `""`, ensuring all requests use same-origin relative paths (`/api/...`). No secrets belong in the frontend!

### Express Server (`server/.env`)
| Variable | Description | Required |
|---|---|---|
| `PORT` | Listening port for Express | No (default `5001`) |
| `NODE_ENV` | Environment mode | Yes (`production` / `development`) |
| `STREAM_BASE_URL` | URL of the internal Python service | Yes (e.g., `http://localhost:5002` or Render internal URL) |
| `GENIUS_API_KEY` | Genius API Client Token for search & metadata | Recommended |
| `HF_TOKEN` | Hugging Face user access token (`hf_...`) | Recommended for AI Studio |
| `HF_CHAT_MODEL` | Model served via `router.huggingface.co/v1` | No (default: `Qwen/Qwen3-32B:fastest`) |
| `APP_ORIGIN` | Allowed CORS origin(s) | No (allow same-origin or comma-separated URLs) |

### Python Engine (`python/.env`)
| Variable | Description | Required |
|---|---|---|
| `PORT` | Listening port for Flask | No (default `5002`) |
| `GENIUS_ACCESS_TOKEN` | Access token for `lyricsgenius` fallback | Recommended |
| `YOUTUBE_COOKIES` | Raw Netscape cookie text or base64 string | Optional (for bot-check bypass on cloud servers) |

---

## 5. Local Setup

### Prerequisites
- Node.js `22.x`
- Python `3.12.x`
- Git

### Windows Quickstart (One Command)
A convenience batch file is provided to start all three tiers concurrently in a single terminal:
```bat
run.bat
```

### Manual Setup (macOS / Linux / Windows)

1. **Stream Engine (Python)**:
   ```bash
   cd python
   python -m venv .venv
   # Windows: .venv\Scripts\activate | macOS/Linux: source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env
   python audio_service.py
   ```

2. **API Bridge (Express)**:
   ```bash
   cd server
   npm install
   cp .env.example .env
   npm run dev
   ```

3. **Frontend Client (Vite)**:
   ```bash
   npm install
   cp .env.local.example .env.local
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

## 6. Deployment (Render Blueprint)

The repository includes a ready-to-deploy [`render.yaml`](file:///d:/Attachments/Tansen/render.yaml) specification configured for Render:

- **Node Web Service (`tansen`)**:
  - Build: `npm ci && npm run build && npm --prefix server ci --omit=dev`
  - Start: `npm --prefix server start`
  - Health check: `/health`
- **Python Web Service (`tansen-stream`)**:
  - Build: `pip install --upgrade pip && pip install -r requirements.txt`
  - Start: `gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120 audio_service:app`
  - Health check: `/health`

---

## 7. Verification & Quality Commands

```bash
# 1. Run pure algorithmic behavior test suite (LRC, Romanize, Dedupe, Confidence)
npm test

# 2. Type-check TypeScript
npx tsc --noEmit

# 3. Production Vite build
npm run build

# 4. Verify Express JavaScript syntax
node --check server/src/index.js

# 5. Compile check Python service
python -m compileall python

# 6. Audit dependencies for security vulnerabilities
npm audit
npm --prefix server audit
```

---

## 8. Provider Limitations & Security Notes

- **yt-dlp on Cloud IPs**: Render and other public cloud providers' datacenter IP ranges may occasionally encounter YouTube bot verification challenges. Tansen mitigates this by providing dual playback: direct `.m4a` audio streaming when available, with automatic client-side YouTube player fallback so tracks continue playing regardless of cloud IP blocks.
- **Genius Lyrics**: Genius API provides metadata and URL endpoints; full lyric texts are scraped on-demand from selected canonical pages with a 0.72 confidence requirement.
- **LRCLIB Coverage**: LRCLIB provides crowd-sourced, timestamped line synchronization. Untimed lyrics gracefully fall back to reading mode.
- **Secret Rotation**: Never commit `.env` or paste tokens into client code. Hugging Face tokens and Genius API keys must reside exclusively on the server. If any token is ever accidentally logged, immediately revoke and re-issue it via the provider's dashboard.

---

## 9. License

This project is open source and available under the [MIT License](LICENSE).
