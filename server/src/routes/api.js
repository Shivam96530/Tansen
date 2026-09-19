import { Router } from "express";
import { searchSongs, getAudioStream } from "../controllers/searchController.js";
import { getLyrics } from "../controllers/lyricsController.js";
import { analyseMood } from "../controllers/aiController.js";
import { searchLimiter, lyricsLimiter, audioLimiter, aiLimiter } from "../lib/rateLimit.js";

const router = Router();

router.get("/search", searchLimiter, searchSongs);
router.get("/lyrics", lyricsLimiter, getLyrics);
router.get("/get-audio-url/:videoId", audioLimiter, getAudioStream);
router.post("/ai/analyse", aiLimiter, analyseMood);

export default router;
