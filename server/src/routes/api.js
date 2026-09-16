import { Router } from "express";
import { searchSongs } from "../controllers/searchController.js";
import { getLyrics } from "../controllers/lyricsController.js";

const router = Router();

router.get("/search", searchSongs);
router.get("/lyrics", getLyrics);

export default router;
