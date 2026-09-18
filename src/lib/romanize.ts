/**
 * Zero-dependency Indic (Devanagari & Gurmukhi) Romanizer for song lyrics.
 *
 * Converts Hindi, Punjabi, and Sanskrit script lyrics into natural, phonetic
 * Roman text (chat/WhatsApp/karaoke style: "tum hi ho", "tere vaaste", "mera", "dil")
 * while preserving English lyrics, numbers, punctuation, and unsupported characters byte-for-byte.
 */

// Devanagari maps
const DEVA_VOWELS: Record<string, string> = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
  "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
  "अं": "an", "अः": "ah", "ऑ": "o",
};

const DEVA_MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ॉ": "o", "ॅ": "e",
};

const DEVA_CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  // Nukta consonants
  "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f",
};

// Gurmukhi maps
const GUR_VOWELS: Record<string, string> = {
  "ਅ": "a", "ਆ": "aa", "ਇ": "i", "ਈ": "ee", "ਉ": "u", "ਊ": "oo",
  "ਏ": "e", "ਐ": "ai", "ਓ": "o", "ਔ": "au",
};

const GUR_MATRAS: Record<string, string> = {
  "ਾ": "aa", "ਿ": "i", "ੀ": "ee", "ੁ": "u", "ੂ": "oo",
  "ੇ": "e", "ੈ": "ai", "ੋ": "o", "ੌ": "au",
};

const GUR_CONSONANTS: Record<string, string> = {
  "ਸ": "s", "ਹ": "h", "ਕ": "k", "ਖ": "kh", "ਗ": "g", "ਘ": "gh", "ਙ": "ng",
  "ਚ": "ch", "ਛ": "chh", "ਜ": "j", "ਝ": "jh", "ਞ": "ny",
  "ਟ": "t", "ਠ": "th", "ਡ": "d", "ਢ": "dh", "ਣ": "n",
  "ਤ": "t", "ਥ": "th", "ਦ": "d", "ਧ": "dh", "ਨ": "n",
  "ਪ": "p", "ਫ": "ph", "ਬ": "b", "ਭ": "bh", "ਮ": "m",
  "ਯ": "y", "ਰ": "r", "ਲ": "l", "ਵ": "v", "ੜ": "r",
  "ਸ਼": "sh", "ਜ਼": "z", "ਫ਼": "f", "ਖ਼": "kh", "ਗ਼": "gh", "ਲ਼": "l",
};

const HALANT = "\u094D";
const GUR_HALANT = "\u0A4D";
const NUKTA = "\u093C";
const GUR_NUKTA = "\u0A3C";
const ANUSVARA = "\u0902";
const CHANDRABINDU = "\u0901";
const GUR_BINDI = "\u0A02";
const GUR_TIPPI = "\u0A70";
const GUR_ADDAK = "\u0A71";

const INDIC_SCRIPT_REGEX = /[\u0900-\u097F\u0A00-\u0A7F]/;
const WORD_SPLIT_REGEX = /([^\p{L}\p{N}]+)/u;

function appendConsonant(cons: string, word: string, nextIdx: number): { text: string; advance: number } {
  const nextChar = word[nextIdx];
  if (nextChar === HALANT || nextChar === GUR_HALANT) {
    return { text: cons, advance: 1 };
  }
  const matra = DEVA_MATRAS[nextChar] || GUR_MATRAS[nextChar];
  if (matra) {
    return { text: cons + matra, advance: 1 };
  }
  if (nextIdx >= word.length || !INDIC_SCRIPT_REGEX.test(nextChar)) {
    return { text: cons, advance: 0 };
  }
  return { text: cons + "a", advance: 0 };
}

function transliterateWord(word: string): string {
  if (!word || !INDIC_SCRIPT_REGEX.test(word)) return word;

  let out = "";
  let i = 0;
  const len = word.length;

  while (i < len) {
    const ch = word[i];
    const next = word[i + 1];

    // Check for Nukta combinations
    if (next === NUKTA || next === GUR_NUKTA) {
      const combo = ch + next;
      const cons = DEVA_CONSONANTS[combo] || GUR_CONSONANTS[combo];
      if (cons) {
        const { text, advance } = appendConsonant(cons, word, i + 2);
        out += text;
        i += 2 + advance;
        continue;
      }
    }

    // Gurmukhi addak (gemination)
    if (ch === GUR_ADDAK && next) {
      const nextCons = GUR_CONSONANTS[next] || DEVA_CONSONANTS[next];
      if (nextCons) {
        out += nextCons[0];
      }
      i++;
      continue;
    }

    // Modifiers (Anusvara, Chandrabindu, Tippi, Bindi)
    if (ch === ANUSVARA || ch === CHANDRABINDU || ch === GUR_BINDI || ch === GUR_TIPPI) {
      out += "n";
      i++;
      continue;
    }

    // Independent Vowels
    if (DEVA_VOWELS[ch] || GUR_VOWELS[ch]) {
      out += DEVA_VOWELS[ch] || GUR_VOWELS[ch];
      i++;
      continue;
    }

    // Halant / Virama standalone skip
    if (ch === HALANT || ch === GUR_HALANT) {
      i++;
      continue;
    }

    // Consonants
    const cons = DEVA_CONSONANTS[ch] || GUR_CONSONANTS[ch];
    if (cons) {
      const { text, advance } = appendConsonant(cons, word, i + 1);
      out += text;
      i += 1 + advance;
      continue;
    }

    // Matras (standalone/unattached fallback)
    const matra = DEVA_MATRAS[ch] || GUR_MATRAS[ch];
    if (matra) {
      out += matra;
      i++;
      continue;
    }

    // Any other character in the word
    out += ch;
    i++;
  }

  // Post-processing for natural Hindi/Punjabi phonetics
  return postProcessPhonetics(out);
}

function postProcessPhonetics(text: string): string {
  let s = text
    .replace(/aa\b/g, "a") // "meraa" -> "mera", "teraa" -> "tera" at end of word
    .replace(/eey/g, "iy")
    .replace(/ph/g, "f") // casual Hindi/Punjabi preference "saaf", "fikr"
    .replace(/ee/g, "i") // casual Roman lyrics preference "tum hi ho"
    .replace(/oo/g, "u");

  // Common Hindi/Urdu high-frequency lyric words adjustments
  const replacements: Record<string, string> = {
    "me": "mein",
    "mai": "main",
    "hu": "hoon",
    "hun": "hoon",
    "tume": "tumhe",
    "hume": "humhe",
    "ki": "ki",
    "ko": "ko",
    "ka": "ka",
    "ke": "ke",
    "se": "se",
    "ne": "ne",
    "hai": "hai",
    "hain": "hain",
    "ho": "ho",
  };

  const lower = s.toLowerCase();
  if (replacements[lower]) {
    return replacements[lower];
  }

  return s;
}

/**
 * Romanize only supported Indic characters; English, Latin, numbers,
 * and punctuation stay untouched byte-for-byte.
 */
export function romanizeLyrics(text: string): string {
  if (!text || !INDIC_SCRIPT_REGEX.test(text)) return text;

  return text
    .split(WORD_SPLIT_REGEX)
    .map((token) => transliterateWord(token))
    .join("");
}

export function hasRomanizableScript(text: string): boolean {
  return INDIC_SCRIPT_REGEX.test(text);
}
