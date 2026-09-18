import rateLimit from "express-rate-limit";

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  windowMs: 60 * 1000,
  message: {
    error: "Too many requests. Please slow down.",
    retryAfter: "1 minute",
  },
};

export const searchLimiter = rateLimit({
  ...base,
  max: 30,
  windowMs: 60 * 1000,
});

export const lyricsLimiter = rateLimit({
  ...base,
  max: 20,
  windowMs: 60 * 1000,
});

export const audioLimiter = rateLimit({
  ...base,
  max: 30,
  windowMs: 60 * 1000,
});

export const aiLimiter = rateLimit({
  ...base,
  max: 10,
  windowMs: 60 * 1000,
});
