import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import apiRoutes from "./routes/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 5001);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) =>
  res.json({ status: "ok", service: "api-bridge", port: PORT })
);

app.use("/api", apiRoutes);

// Serve static assets from the React dist directory
const distPath = path.resolve(__dirname, "../../dist");
app.use(express.static(distPath));

// Fallback all other routes to index.html for React SPA navigation
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

app.listen(PORT, () => {
  console.log(`· API bridge listening on http://localhost:${PORT}`);
  console.log(`· GET /api/search?q=   → yt-dlp (via stream engine) / Genius metadata`);
  console.log(`· GET /api/lyrics?q=   → Genius page scrape ([data-lyrics-container])`);
});

