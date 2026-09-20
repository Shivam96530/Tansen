/**
 * streamProxy.cjs — Express handler for GET /api/stream/:id
 *
 * Pipes the Flask stream engine's /stream/:id response (audio bytes, HTTP Range
 * supported) straight to the browser, so the <audio> element plays a same-origin
 * URL. Nothing is buffered or stored: bytes flow Flask → Express → phone.
 *
 * Saved as .cjs so it loads the same way whether your server uses
 * CommonJS (require) or ES modules (import).
 *
 * Mount it (pick the one that matches your server file):
 *
 *   // CommonJS
 *   const streamProxy = require("./streamProxy.cjs");
 *   app.get("/api/stream/:id", streamProxy);
 *
 *   // ES modules
 *   import streamProxy from "./streamProxy.cjs";
 *   app.get("/api/stream/:id", streamProxy);
 *
 * Config: STREAM_ENGINE_URL = base URL of the Flask service. Use the SAME
 * address your existing /api/get-audio-url route already talks to.
 * Defaults to http://localhost:5002.
 */

const http = require("http");
const https = require("https");

const STREAM_ENGINE_URL = process.env.STREAM_ENGINE_URL || process.env.STREAM_BASE_URL || "http://localhost:5002";
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
// yt-dlp can take a while on a cold lookup; after that, bytes flow continuously.
const UPSTREAM_TIMEOUT_MS = 60000;

// Only these upstream headers are relayed to the browser.
const RELAYED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"];

function streamProxy(req, res) {
  const id = req.params.id;
  if (!VIDEO_ID_RE.test(id)) {
    return res.status(400).json({ error: "Invalid video id" });
  }

  const target = new URL(`/stream/${id}`, STREAM_ENGINE_URL);
  const transport = target.protocol === "https:" ? https : http;

  // Forward Range so seeking / resuming works; nothing else from the browser is needed.
  const headers = {};
  if (req.headers.range) headers.range = req.headers.range;

  const upstream = transport.request(target, { method: req.method === "HEAD" ? "HEAD" : "GET", headers }, (up) => {
    res.status(up.statusCode || 502);
    for (const name of RELAYED_HEADERS) {
      if (up.headers[name]) res.setHeader(name, up.headers[name]);
    }
    up.pipe(res);
    up.on("error", () => res.destroy());
  });

  upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => upstream.destroy(new Error("Upstream timeout")));

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: "Stream engine unreachable", detail: err.message });
    } else {
      res.destroy();
    }
  });

  // Listener went away (skipped song, closed tab, locked phone dropped the socket):
  // stop pulling bytes so Flask releases its connection to YouTube.
  res.on("close", () => {
    if (!res.writableFinished) upstream.destroy();
  });

  upstream.end();
}

module.exports = streamProxy;
module.exports.default = streamProxy;
