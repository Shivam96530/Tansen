"""
Stream engine · Flask microservice
==================================

Audio search & direct-stream resolution via yt-dlp, lyrics via Genius.

Endpoints
---------
GET /health                        → service heartbeat
GET /search?q=<query>&limit=<n>    → deduplicated results, up to 8 distinct songs (default)
GET /get-audio-url/<video_id>      → direct .m4a stream URL (never downloads media)
GET /lyrics?query=<query>          → cleaned lyrics text via lyricsgenius

Port: 5002
"""

import os
import re
import tempfile

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
import yt_dlp

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

app = Flask(__name__)
CORS(app)

import base64

PORT = int(os.environ.get("PORT", 5002))

# ── YouTube cookie support ───────────────────────────────────────────────────
# On cloud servers YouTube requires authentication via cookies.
# We support:
# 1. Local python/cookies.txt file
# 2. YOUTUBE_COOKIES environment variable (raw Netscape or base64-encoded)
#
# Pasting multiline text in web dashboards often mangles tabs to spaces or
# escapes newlines as literal \n. This parser normalizes everything into a
# valid Netscape 7-column tab-separated file.

def _init_cookie_file() -> tuple[str | None, dict]:
    info = {"configured": False, "source": None, "lines": 0, "valid_cookies": 0, "bytes": 0}
    raw = ""

    local_path = os.path.join(os.path.dirname(__file__), "cookies.txt")
    if os.path.isfile(local_path) and os.path.getsize(local_path) > 0:
        try:
            with open(local_path, "r", encoding="utf-8", errors="ignore") as f:
                raw = f.read()
            info["source"] = "local_file"
        except Exception:
            pass

    if not raw:
        env_val = os.environ.get("YOUTUBE_COOKIES", "").strip()
        if env_val:
            # Check if base64 encoded
            try:
                decoded = base64.b64decode(env_val).decode("utf-8", errors="ignore")
                if "youtube.com" in decoded:
                    raw = decoded
                    info["source"] = "env_base64"
            except Exception:
                pass

            if not raw:
                raw = env_val
                info["source"] = "env_raw"

    if not raw:
        return None, info

    # Strip wrapping quotes
    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
        raw = raw[1:-1].strip()

    # Unescape literal \r\n and \n if Render passed escaped newlines
    if "\\n" in raw:
        raw = raw.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\t", "\t")

    sanitized_lines = []
    has_header = False
    valid_count = 0

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            if "Netscape" in line:
                has_header = True
            sanitized_lines.append(line)
            continue

        # Split on any whitespace sequence (converts spaces back to tabs)
        parts = re.split(r"\s+", line)
        if len(parts) >= 7:
            domain, flag, path, secure, expiry, name = parts[:6]
            val = " ".join(parts[6:])
            sanitized_lines.append(f"{domain}\t{flag}\t{path}\t{secure}\t{expiry}\t{name}\t{val}")
            valid_count += 1
        elif "\t" in line:
            sanitized_lines.append(line)
            valid_count += 1
        else:
            sanitized_lines.append(line)

    if not has_header:
        sanitized_lines.insert(0, "# Netscape HTTP Cookie File")

    final_content = "\n".join(sanitized_lines) + "\n"

    try:
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8")
        tmp.write(final_content)
        tmp.close()
        info["configured"] = True
        info["lines"] = len(sanitized_lines)
        info["valid_cookies"] = valid_count
        info["bytes"] = len(final_content.encode("utf-8"))
        info["path"] = tmp.name
        return tmp.name, info
    except Exception as e:
        info["error"] = str(e)
        return None, info


_COOKIE_FILE, _COOKIE_INFO = _init_cookie_file()

def _cookie_opts() -> dict:
    """Return cookiefile option dict if cookies are configured."""
    return {"cookiefile": _COOKIE_FILE} if _COOKIE_FILE else {}
# ────────────────────────────────────────────────────────────────────────────

SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": True,
    "noplaylist": True,
    "skip_download": True,
    "extractor_args": {"youtube": {"player_client": ["android", "ios", "web"]}},
    **_cookie_opts(),
}



# ---------------------------------------------------------------- helpers

def _pick_audio_url(info: dict) -> str | None:
    """Choose the best audio stream URL from an yt-dlp info dict."""
    formats = info.get("formats") or []
    audio_candidates = [
        f for f in formats
        if f.get("acodec") not in (None, "none") and f.get("url")
    ]

    def score(fmt: dict) -> tuple:
        return (
            1 if fmt.get("ext") == "m4a" else 0,
            fmt.get("abr") or 0,
        )

    if audio_candidates:
        return sorted(audio_candidates, key=score, reverse=True)[0].get("url")
    return info.get("url")


_NOISE_WORDS = (
    "official video", "official music video", "official audio", "official",
    "full video song", "full video", "full song", "video song", "lyric video",
    "lyrics video", "lyrics", "lyric", "audio", "video", "hd", "4k", "1080p",
    "720p", "remastered", "slowed and reverb", "slowed", "reverb",
    "bass boosted", "visualizer", "song", "songs",
)


def _song_key(title: str) -> str:
    """Collapse an upload title to a song identity (dedupe re-uploads)."""
    s = (title or "").lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = s.split("|")[0]
    s = re.sub(r"\b(feat|ft|featuring|with)\b.*$", " ", s)
    for w in _NOISE_WORDS:
        s = re.sub(rf"\b{re.escape(w)}\b", " ", s)
    s = re.sub(r"[^0-9a-z\u0900-\u097F\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _clean_lyrics(raw: str) -> str:
    """Strip lyricsgenius chrome (contributor headers, 'Embed' footers)."""
    text = raw
    text = re.sub(r"^\d+\s+Contributors.*?\n", "", text, flags=re.S)
    text = re.sub(r"^.*?Lyrics\n", "", text, count=1)
    text = re.sub(r"\d*\s*Embed\s*$", "", text)
    text = re.sub(r"You might also like\s*\n", "", text)
    return text.strip()


# ---------------------------------------------------------------- routes

@app.get("/health")
def health():
    return jsonify(
        status="ok",
        service="stream-engine",
        port=PORT,
        cookies=_COOKIE_INFO,
    )


@app.get("/search")
def search():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify(error="Missing query param ?q="), 400

    # Ask for a wider net, then collapse duplicate uploads of the same song so
    # the client receives distinct tracks (not 5 copies of one hit).
    limit = min(int(request.args.get("limit", 8) or 8), 15)
    try:
        with yt_dlp.YoutubeDL(SEARCH_OPTS) as ydl:
            info = ydl.extract_info(f"ytsearch{limit * 2}:{query}", download=False)

        results, seen = [], set()
        for entry in info.get("entries") or []:
            if not entry or not entry.get("id"):
                continue
            key = _song_key(entry.get("title") or "")
            if key and key in seen:
                continue
            seen.add(key)
            results.append(
                {
                    "id": entry["id"],
                    "title": entry.get("title") or "Untitled",
                    "artist": entry.get("channel") or entry.get("uploader") or "Unknown artist",
                    "thumbnail": f"https://i.ytimg.com/vi/{entry['id']}/hqdefault.jpg",
                    "duration": entry.get("duration") or 0,
                }
            )
            if len(results) >= limit:
                break
        return jsonify(source="youtube", query=query, results=results)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error="Search failed", detail=str(exc)), 502


@app.get("/get-audio-url/<video_id>")
def get_audio_url(video_id: str):
    """Resolve a YouTube video id to its direct audio stream URL (.m4a)."""
    page_url = f"https://www.youtube.com/watch?v={video_id}"

    # Multi-strategy extraction with automatic fallback
    strategies = [
        # Strategy 1: Default yt-dlp client chain with cookies (web with cookies)
        {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
            "format": "bestaudio/best",
            **_cookie_opts(),
        },
        # Strategy 2: Android + Web client fallback
        {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
            "format": "bestaudio/best",
            "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
            **_cookie_opts(),
        },
        # Strategy 3: Web-only
        {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
            "format": "bestaudio/best",
            "extractor_args": {"youtube": {"player_client": ["web"]}},
            **_cookie_opts(),
        },
    ]

    last_exc = None
    for opts in strategies:
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(page_url, download=False)
            if not info:
                continue
            audio_url = _pick_audio_url(info)
            if audio_url:
                return jsonify(
                    id=video_id,
                    title=info.get("title"),
                    duration=info.get("duration") or 0,
                    audio_url=audio_url,
                )
        except Exception as exc:
            last_exc = exc
            continue

    if last_exc:
        return jsonify(
            error="Stream resolution failed",
            detail=str(last_exc),
            cookie_status=_COOKIE_INFO,
        ), 502

    return jsonify(id=video_id, audio_url=None, note="no-stream")


@app.get("/lyrics")
def lyrics():
    query = (request.args.get("query") or "").strip()
    if not query:
        return jsonify(error="Missing query param ?query="), 400

    token = os.environ.get("GENIUS_ACCESS_TOKEN")
    if not token:
        return jsonify(error="GENIUS_ACCESS_TOKEN is not configured."), 503

    try:
        import lyricsgenius

        genius = lyricsgenius.Genius(
            token,
            skip_non_songs=True,
            excluded_terms=["(Remix)", "(Live)"],
            timeout=10,
        )
        genius.verbose = False
        song = genius.search_song(query)
        if not song:
            return jsonify(title=None, artist=None, lyrics="", note="no-match")

        return jsonify(
            title=song.title,
            artist=song.artist,
            lyrics=_clean_lyrics(song.lyrics),
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify(error="Lyrics lookup failed", detail=str(exc)), 502


if __name__ == "__main__":
    print(f"· Stream engine on http://localhost:{PORT}")
    print("· GET /search?q=&limit=     → deduplicated results (default 8)")
    print("· GET /get-audio-url/<id>   → direct .m4a stream URL")
    print("· GET /lyrics?query=        → lyricsgenius text")
    app.run(host="0.0.0.0", port=PORT, debug=False)
