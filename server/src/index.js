import "dotenv/config";
import express from "express";
import cors from "cors";
import apiRoutes from "./routes/api.js";

const app = express();
const PORT = Number(process.env.PORT || 5001);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) =>
  res.json({ status: "ok", service: "api-bridge", port: PORT })
);

app.use("/api", apiRoutes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`· API bridge listening on http://localhost:${PORT}`);
  console.log(`· GET /api/search?q=   → yt-dlp (via stream engine) / Genius metadata`);
  console.log(`· GET /api/lyrics?q=   → Genius page scrape ([data-lyrics-container])`);
});
