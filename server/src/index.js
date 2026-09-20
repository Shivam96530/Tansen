import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import apiRoutes from "./routes/api.js";
import streamProxy from "./streamProxy.cjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 5001);
const STREAM_BASE = (process.env.STREAM_BASE_URL || "http://localhost:5002").replace(/\/+$/, "");
const APP_ORIGIN = (process.env.APP_ORIGIN || "").trim();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
          "https://s.ytimg.com",
        ],
        frameSrc: [
          "'self'",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://i.ytimg.com",
          "https://img.youtube.com",
          "https://images.genius.com",
          "https://lh3.googleusercontent.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: [
          "'self'",
          "https://api-inference.huggingface.co",
          "https://router.huggingface.co",
          "https://api.genius.com",
          "https://lrclib.net",
          "https://api.lyrics.ovh",
          "https://www.youtube.com",
          "https://www.googlevideo.com",
          "https://i.ytimg.com",
        ],
        mediaSrc: ["'self'", "blob:", "https://www.googlevideo.com", "https://www.youtube.com"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);

if (APP_ORIGIN) {
  const allowedOrigins = APP_ORIGIN.split(",").map((s) => s.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "POST"],
      credentials: false,
    })
  );
} else {
  app.use(cors());
}

app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) =>
  res.json({ status: "ok", service: "api-bridge", port: PORT })
);

app.get("/api/stream-health", async (_req, res) => {
  try {
    const { data } = await axios.get(`${STREAM_BASE}/health`, { timeout: 4000 });
    return res.json(data);
  } catch {
    return res.status(503).json({ status: "offline", service: "stream-engine" });
  }
});

app.get("/api/stream/:id", streamProxy);

app.use("/api", apiRoutes);

const distPath = path.resolve(__dirname, "../../dist");
app.use(express.static(distPath));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(distPath, "index.html"), (err) => {
    if (err) {
      res.status(404).json({ error: "Frontend build not found" });
    }
  });
});

// Final error handling middleware — never leak stack traces to client
app.use((err, _req, res, _next) => {
  const status = Number(err.status || err.statusCode || 500);
  const message = status < 500 ? err.message : "Internal Server Error";
  return res.status(status).json({ error: message });
});

const server = app.listen(PORT, () => {
  console.log(`· API bridge listening on http://localhost:${PORT}`);
  console.log(`· GET /api/search?q=       → yt-dlp (via stream engine)`);
  console.log(`· GET /api/lyrics?q=       → Genius + LRCLIB confidence-matched lyrics`);
  console.log(`· POST /api/ai/analyse    → server-side Hugging Face emotion + recommendation intelligence`);
});

function shutdown(sig) {
  console.log(`Received ${sig}, closing server gracefully...`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 8000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
