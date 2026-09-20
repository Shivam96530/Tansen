import json
import sys
import urllib.request
import yt_dlp

def get_subtitles(video_id: str):
    if not video_id:
        print("{}")
        return

    ydl = yt_dlp.YoutubeDL({"quiet": True, "skip_download": True, "no_warnings": True})
    try:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    except Exception:
        print("{}")
        return

    subs = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}

    target_url = None
    # 1. Priority manual languages
    for lang in ("en", "hi", "en-IN", "hi-Latn", "ur", "pa", "es", "fr", "de"):
        if lang in subs:
            for s in subs[lang]:
                if s.get("ext") == "json3":
                    target_url = s.get("url")
                    break
            if target_url:
                break

    # 2. Any manual subtitles
    if not target_url and subs:
        for lang, slist in subs.items():
            for s in slist:
                if s.get("ext") == "json3":
                    target_url = s.get("url")
                    break
            if target_url:
                break

    # 3. Speech-to-text auto-captions
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
        print("{}")
        return

    try:
        req = urllib.request.Request(target_url, headers={"User-Agent": "Mozilla/5.0"})
        data = json.loads(urllib.request.urlopen(req, timeout=10).read())
        lines = []
        plain = []
        for ev in data.get("events", []):
            t_sec = (ev.get("tStartMs", 0)) / 1000.0
            m = int(t_sec // 60)
            s = t_sec % 60
            text = "".join(seg.get("utf8", "") for seg in ev.get("segs", [])).strip().replace("\n", " ")
            if text:
                lines.append(f"[{m:02d}:{s:05.2f}] {text}")
                plain.append(text)

        if len(lines) < 3:
            print("{}")
            return

        print(json.dumps({"syncedLyrics": "\n".join(lines), "plainLyrics": "\n".join(plain)}))
    except Exception:
        print("{}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        get_subtitles(sys.argv[1])
    else:
        print("{}")
