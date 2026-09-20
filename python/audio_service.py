"""
Stream engine · Flask microservice
==================================

Audio search & direct-stream resolution via yt-dlp, lyrics via Genius.

Endpoints
---------
GET /health                        → service heartbeat
GET /search?q=<query>&limit=<n>    → deduplicated results, up to 8 distinct songs (default)
GET /stream/<video_id>             → audio bytes, proxied from YouTube with HTTP Range support
                                     (this is what the browser's <audio> element plays)
GET /get-audio-url/<video_id>      → direct .m4a stream URL (legacy; IP-locked to this server)
GET /lyrics?query=<query>          → cleaned lyrics text via lyricsgenius

Port: 5002
"""

import os
import re
import sys
import tempfile
import threading
import time

# Ensure UTF-8 output on Windows consoles to prevent UnicodeEncodeError crashes
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import atexit
import json
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
import yt_dlp

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

app = Flask(__name__)

import base64

PORT = int(os.environ.get("PORT", 5002))

# YouTube video ids are 11 chars of [A-Za-z0-9_-]. We interpolate the id into a URL,
# so never accept anything else.
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,20}$")

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

def _cleanup_cookie_file():
    if _COOKIE_FILE and os.path.exists(_COOKIE_FILE):
        try:
            os.remove(_COOKIE_FILE)
        except Exception:
            pass

atexit.register(_cleanup_cookie_file)

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


def _extractor_strategies() -> list[dict]:
    """yt-dlp option sets tried in order until one yields a playable format."""
    base = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "format": "bestaudio/best",
    }
    return [
        # Strategy 1: Default yt-dlp client chain with cookies (web with cookies)
        {**base, **_cookie_opts()},
        # Strategy 2: Android + Web client fallback
        {**base, "extractor_args": {"youtube": {"player_client": ["android", "web"]}}, **_cookie_opts()},
        # Strategy 3: Web-only
        {**base, "extractor_args": {"youtube": {"player_client": ["web"]}}, **_cookie_opts()},
    ]


_NOISE_WORDS = (
    "official video", "official music video", "official audio", "official",
    "full video song", "full video", "full song", "video song", "lyric video",
    "lyrics video", "lyrics", "lyric", "audio", "video", "hd", "4k", "1080p",
    "720p", "remastered", "slowed and reverb", "slowed", "reverb",
    "bass boosted", "visualizer", "song", "songs",
)


_PLAYLIST_RE = re.compile(
    r"\b(jukebox|full album|nonstop|non stop|compilation|all songs|top \d+|best of \d+|hour mix|\d+\s*hours?|\d+\s*min(?:s|utes)? mix|playlist|mashup mix)\b",
    re.IGNORECASE,
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


# ------------------------------------------------- stream resolution & cache
# The browser's <audio> element needs a URL it can Range-request. yt-dlp's raw
# googlevideo URL is locked to THIS server's IP, so the phone can't use it
# directly. Instead /stream/<id> resolves the URL here (cached, because a yt-dlp
# lookup takes seconds and the browser sends several Range requests per song)
# and pipes the bytes through.

_HTTP_PROTOCOLS = ("https", "http")
_MIME_BY_EXT = {"m4a": "audio/mp4", "mp4": "audio/mp4", "webm": "audio/webm", "opus": "audio/ogg"}

_STREAM_TTL_SEC = 25 * 60       # googlevideo links live for hours; refresh well before that
_STREAM_CACHE_MAX = 200
_STREAM_CACHE: dict[str, dict] = {}
_RESOLVE_LOCKS: dict[str, threading.Lock] = {}   # one lock per video → concurrent requests share one lookup
_CACHE_LOCK = threading.Lock()

_SUB_CACHE: dict[str, dict] = {}
_SUB_LOCK = threading.Lock()


def _extract_lrc_from_info(info: dict) -> dict | None:
    """Extract YouTube's official or automatic timed captions and format as frame-accurate LRC."""
    if not info:
        return None
    subs = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}

    target_url = None
    # 1. Prefer manual subtitles in priority languages (en, hi, regional)
    for lang in ("en", "hi", "en-IN", "hi-Latn", "ur", "pa", "es", "fr", "de"):
        if lang in subs:
            for s in subs[lang]:
                if s.get("ext") == "json3":
                    target_url = s.get("url")
                    break
            if target_url:
                break

    # 2. Check any other manual subtitle
    if not target_url and subs:
        for lang, slist in subs.items():
            for s in slist:
                if s.get("ext") == "json3":
                    target_url = s.get("url")
                    break
            if target_url:
                break

    # 3. Fallback to speech-recognition auto-captions
    if not target_url and auto:
        for lang in ("en", "hi", "en-IN", "hi-Latn"):
            if lang in auto:
                for s in auto[lang]:
                    if s.get("ext") == "json3":
                        target_url = s.get("url")
                        break
                if target_url:
                    break

    if not target_url:
        return None

    try:
        req = urllib.request.Request(target_url, headers={"User-Agent": "Mozilla/5.0"})
        data = json.loads(urllib.request.urlopen(req, timeout=10).read())
        lines = []
        plain = []
        for ev in data.get("events", []):
            t_ms = ev.get("tStartMs", 0)
            t_sec = t_ms / 1000.0
            m = int(t_sec // 60)
            s = t_sec % 60
            text = "".join(seg.get("utf8", "") for seg in ev.get("segs", [])).strip()
            text = text.replace("\n", " ").strip()
            if text and text != "\n":
                lines.append(f"[{m:02d}:{s:05.2f}] {text}")
                plain.append(text)

        if len(lines) < 3:
            return None
        return {"syncedLyrics": "\n".join(lines), "plainLyrics": "\n".join(plain)}
    except Exception:
        return None


def _cache_subtitles_for_info(video_id: str, info: dict):
    try:
        res = _extract_lrc_from_info(info)
        with _SUB_LOCK:
            _SUB_CACHE[video_id] = res or {}
    except Exception:
        pass


class StreamResolveError(Exception):
    """yt-dlp could not produce a playable audio stream."""


def _pick_audio_stream(info: dict) -> dict | None:
    """
    Choose the best audio stream that can be proxied as plain HTTP bytes.
    Prefers audio-only, then m4a (plays everywhere, incl. iOS Safari), then highest bitrate.
    HLS/DASH manifests are skipped: they are not a single seekable file.
    """
    def usable(f: dict) -> bool:
        return bool(
            f.get("url")
            and f.get("acodec") not in (None, "none")
            and (f.get("protocol") or "https") in _HTTP_PROTOCOLS
        )

    def score(f: dict) -> tuple:
        return (
            1 if f.get("vcodec") in (None, "none") else 0,
            1 if f.get("ext") == "m4a" else 0,
            f.get("abr") or 0,
        )

    candidates = sorted((f for f in (info.get("formats") or []) if usable(f)), key=score, reverse=True)
    chosen = candidates[0] if candidates else None
    if chosen is None and info.get("url") and (info.get("protocol") or "https") in _HTTP_PROTOCOLS:
        chosen = info
    if not chosen:
        return None

    headers = dict(chosen.get("http_headers") or info.get("http_headers") or {})
    return {"url": chosen["url"], "ext": chosen.get("ext") or "m4a", "headers": headers}


def _url_expiry(url: str) -> float | None:
    """googlevideo URLs carry their own expiry as ?expire=<unix ts>."""
    try:
        return float(parse_qs(urlparse(url).query)["expire"][0])
    except Exception:
        return None


def _cache_get(video_id: str) -> dict | None:
    with _CACHE_LOCK:
        entry = _STREAM_CACHE.get(video_id)
        if entry and entry["expires"] > time.time():
            return entry
        _STREAM_CACHE.pop(video_id, None)
        return None


def _cache_put(video_id: str, entry: dict) -> None:
    with _CACHE_LOCK:
        now = time.time()
        for key in [k for k, v in _STREAM_CACHE.items() if v["expires"] <= now]:
            del _STREAM_CACHE[key]
        while len(_STREAM_CACHE) >= _STREAM_CACHE_MAX:
            oldest = min(_STREAM_CACHE, key=lambda k: _STREAM_CACHE[k]["expires"])
            del _STREAM_CACHE[oldest]
        _STREAM_CACHE[video_id] = entry
        if len(_RESOLVE_LOCKS) > 500:  # keep the lock table bounded
            for key, lock in list(_RESOLVE_LOCKS.items()):
                if not lock.locked():
                    _RESOLVE_LOCKS.pop(key, None)


def _resolve_stream(video_id: str, stale_url: str | None = None) -> dict:
    """
    Return {"url", "ext", "headers", "expires"} for a video, using the cache when possible.
    Pass `stale_url` after the upstream rejected a URL so we re-resolve instead of reusing it.
    """
    cached = _cache_get(video_id)
    if cached and cached["url"] != stale_url:
        return cached

    lock = _RESOLVE_LOCKS.setdefault(video_id, threading.Lock())
    with lock:
        # Another request may have refreshed it while we waited for the lock.
        cached = _cache_get(video_id)
        if cached and cached["url"] != stale_url:
            return cached

        page_url = f"https://www.youtube.com/watch?v={video_id}"
        last_exc: Exception | None = None
        for opts in _extractor_strategies():
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(page_url, download=False)
                stream = _pick_audio_stream(info) if info else None
                if not stream:
                    continue
                expires = time.time() + _STREAM_TTL_SEC
                upstream_expiry = _url_expiry(stream["url"])
                if upstream_expiry:
                    expires = min(expires, upstream_expiry - 120)
                stream["expires"] = expires
                _cache_put(video_id, stream)
                return stream
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                continue

        with _CACHE_LOCK:
            _STREAM_CACHE.pop(video_id, None)
        raise StreamResolveError(str(last_exc) if last_exc else "no playable audio stream found")


def _open_upstream(stream: dict, range_header: str | None):
    """Open the googlevideo URL, forwarding the browser's Range header so seeking works."""
    headers = {
        k: v for k, v in (stream.get("headers") or {}).items()
        if k.lower() not in ("range", "accept-encoding", "host")
    }
    headers["Accept-Encoding"] = "identity"  # we relay bytes as-is; no gzip surprises
    headers.setdefault("User-Agent", "Mozilla/5.0")
    if range_header:
        headers["Range"] = range_header
    req = urllib.request.Request(stream["url"], headers=headers)
    return urllib.request.urlopen(req, timeout=20)  # noqa: S310 (URL comes from yt-dlp, id is validated)


# ---------------------------------------------------------------- routes

@app.get("/health")
def health():
    return jsonify(
        status="ok",
        service="stream-engine",
        port=PORT,
        cookies_configured=bool(_COOKIE_INFO.get("configured")),
    )


@app.get("/search")
def search():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify(error="Missing query param ?q="), 400

    # Retrieve a generous net so after dropping playlists/jukeboxes we retain distinct single songs.
    limit = min(max(int(request.args.get("limit", 12) or 12), 1), 30)
    fetch_count = min(max(limit * 3, 25), 60)
    try:
        with yt_dlp.YoutubeDL(SEARCH_OPTS) as ydl:
            info = ydl.extract_info(f"ytsearch{fetch_count}:{query}", download=False)

        results, seen = [], set()
        for entry in info.get("entries") or []:
            if not entry or not entry.get("id"):
                continue
            dur = entry.get("duration") or 0
            title = entry.get("title") or "Untitled"

            # Filter out compilations, 2-hour jukeboxes, playlists, and non-song snippets
            if dur > 660 or (dur > 0 and dur < 45):
                continue
            if _PLAYLIST_RE.search(title):
                continue

            key = _song_key(title)
            if key and key in seen:
                continue
            seen.add(key)
            results.append(
                {
                    "id": entry["id"],
                    "title": title,
                    "artist": entry.get("channel") or entry.get("uploader") or "Unknown artist",
                    "channel": entry.get("channel") or entry.get("uploader") or "",
                    "thumbnail": f"https://i.ytimg.com/vi/{entry['id']}/hqdefault.jpg",
                    "duration": dur,
                }
            )
            if len(results) >= limit:
                break
        return jsonify(source="youtube", query=query, results=results)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error="Search failed", detail=str(exc)), 502


@app.route("/stream/<video_id>", methods=["GET", "HEAD"])
def stream_audio(video_id: str):
    """
    Relay a song's audio bytes to the browser (HTTP 200/206 with Range support).
    Nothing is written to disk. This is the URL the <audio> element plays, which is
    what lets playback continue with the screen locked / the tab in the background.
    """
    if not VIDEO_ID_RE.match(video_id):
        return jsonify(error="Invalid video id"), 400

    range_header = request.headers.get("Range")

    try:
        stream = _resolve_stream(video_id)
    except StreamResolveError as exc:
        return jsonify(error="Stream resolution failed", detail=str(exc)), 502

    upstream = None
    for attempt in range(2):
        try:
            upstream = _open_upstream(stream, range_header)
            break
        except urllib.error.HTTPError as exc:
            if exc.code == 416:  # range not satisfiable — relay so the browser can recover
                headers = {"Content-Range": exc.headers.get("Content-Range", "")} if exc.headers else {}
                return Response(status=416, headers=headers)
            # Expired / IP-mismatched / revoked link: resolve a fresh one and retry once.
            if exc.code in (401, 403, 404, 410) and attempt == 0:
                try:
                    stream = _resolve_stream(video_id, stale_url=stream["url"])
                    continue
                except StreamResolveError as inner:
                    return jsonify(error="Stream resolution failed", detail=str(inner)), 502
            return jsonify(error="Upstream refused the stream", upstream_status=exc.code), 502
        except Exception as exc:  # noqa: BLE001  (timeouts, DNS, connection resets)
            return jsonify(error="Upstream unreachable", detail=str(exc)), 502

    if upstream is None:
        return jsonify(error="Upstream unavailable"), 502

    content_type = upstream.headers.get("Content-Type") or _MIME_BY_EXT.get(stream.get("ext", "m4a"), "audio/mp4")
    out_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
    }
    for name in ("Content-Length", "Content-Range"):
        value = upstream.headers.get(name)
        if value:
            out_headers[name] = value

    if request.method == "HEAD":
        upstream.close()
        return Response(status=upstream.status, headers=out_headers, content_type=content_type)

    def generate():
        try:
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        except Exception:  # noqa: BLE001  upstream dropped mid-song; end the body, browser will re-request
            pass
        finally:
            upstream.close()  # also runs when the client disconnects (GeneratorExit)

    return Response(generate(), status=upstream.status, headers=out_headers, content_type=content_type)


@app.get("/get-audio-url/<video_id>")
def get_audio_url(video_id: str):
    """Resolve a YouTube video id to its direct audio stream URL (.m4a). Legacy: IP-locked to this server."""
    if not VIDEO_ID_RE.match(video_id):
        return jsonify(error="Invalid video id"), 400

    page_url = f"https://www.youtube.com/watch?v={video_id}"

    # Multi-strategy extraction with automatic fallback
    last_exc = None
    for opts in _extractor_strategies():
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


@app.get("/subtitles/<video_id>")
def subtitles(video_id: str):
    if not VIDEO_ID_RE.match(video_id):
        return jsonify(error="Invalid video id"), 400

    with _SUB_LOCK:
        cached = _SUB_CACHE.get(video_id)
    if cached is not None:
        if not cached:
            return jsonify(videoId=video_id, syncedLyrics=None, plainLyrics=None, note="no-subtitles"), 404
        return jsonify(videoId=video_id, source="youtube-subs", **cached)

    page_url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True, **_cookie_opts()}) as ydl:
            info = ydl.extract_info(page_url, download=False)
        res = _extract_lrc_from_info(info) if info else None
        with _SUB_LOCK:
            _SUB_CACHE[video_id] = res or {}
        if not res:
            return jsonify(videoId=video_id, syncedLyrics=None, plainLyrics=None, note="no-subtitles"), 404
        return jsonify(videoId=video_id, source="youtube-subs", **res)
    except Exception as exc:  # noqa: BLE001
        return jsonify(error="Failed to fetch subtitles", detail=str(exc)), 502


if __name__ == "__main__":
    print(f"- Stream engine on http://localhost:{PORT}")
    print("- GET /search?q=&limit=     -> deduplicated results (default 8)")
    print("- GET /stream/<id>          -> proxied audio bytes (Range supported)")
    print("- GET /get-audio-url/<id>   -> direct .m4a stream URL (legacy)")
    print("- GET /lyrics?query=        -> lyricsgenius text")
    # threaded=True: every song being played holds one connection open while it streams.
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
