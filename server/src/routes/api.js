import { Router } from "express";
import { searchSongs, getAudioStream } from "../controllers/searchController.js";
import { getLyrics } from "../controllers/lyricsController.js";

const router = Router();

router.get("/search", searchSongs);
router.get("/lyrics", getLyrics);
router.get("/get-audio-url/:videoId", getAudioStream);

export default router;
