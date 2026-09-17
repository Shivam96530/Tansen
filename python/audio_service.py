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

PORT = int(os.environ.get("PORT", 5002))

# ── YouTube cookie support ───────────────────────────────────────────────────
# On cloud servers YouTube requires authentication via cookies.
# Set the YOUTUBE_COOKIES env var (contents of a cookies.txt Netscape file)
# on Render to bypass the "Sign in to confirm you're not a bot" block.
_COOKIE_FILE: str | None = None

_raw_cookies = os.environ.get("YOUTUBE_COOKIES", "").strip()
if _raw_cookies:
    _tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    )
    _tmp.write(_raw_cookies)
    _tmp.close()
    _COOKIE_FILE = _tmp.name

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
    **_cookie_opts(),
}

STREAM_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "skip_download": True,
    # Prefer native audio-only m4a; fall back to any audio-only format.
    "format": "bestaudio[ext=m4a]/bestaudio/best",
    **_cookie_opts(),
}



# ---------------------------------------------------------------- helpers

def _pick_audio_url(info: dict) -> str | None:
    """Choose the best audio-only format URL from an yt-dlp info dict."""
    formats = info.get("formats") or []
    audio_only = [f for f in formats if f.get("acodec") not in (None, "none")]

    def score(fmt: dict) -> tuple:
        return (
            1 if fmt.get("ext") == "m4a" else 0,
            fmt.get("abr") or 0,
        )

    if audio_only:
        return sorted(audio_only, key=score, reverse=True)[0].get("url")
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
    return jsonify(status="ok", service="stream-engine", port=PORT)


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
    try:
        page_url = f"https://www.youtube.com/watch?v={video_id}"
        with yt_dlp.YoutubeDL(STREAM_OPTS) as ydl:
            info = ydl.extract_info(page_url, download=False)

        audio_url = _pick_audio_url(info)
        if not audio_url:
            # Expected case (restricted video) — empty 200 keeps consoles clean;
            # the client falls back gracefully.
            return jsonify(id=video_id, audio_url=None, note="no-stream")

        return jsonify(
            id=video_id,
            title=info.get("title"),
            duration=info.get("duration") or 0,
            audio_url=audio_url,
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify(error="Stream resolution failed", detail=str(exc)), 502


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
