/**
 * Zero-dependency Indic (Devanagari & Gurmukhi) and Perso-Arabic (Urdu)
 * Romanizer for song lyrics.
 *
 * Converts Hindi, Punjabi, and Urdu script lyrics into natural, phonetic
 * Roman text (chat/WhatsApp/karaoke style: "tum hi ho", "tere vaaste",
 * "qismat mein meri chain se jeena likh de", "tajdar-e haram")
 * while preserving English lyrics, numbers, punctuation, and unsupported
 * characters byte-for-byte.
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
  "ੇ": "e", "ੈ": "ai", "ੋ": "o", "ਔ": "au",
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
const URDU_SCRIPT_REGEX = /[\u0600-\u06FF]/;
const ROMANIZABLE_SCRIPT_REGEX = /[\u0900-\u097F\u0A00-\u0A7F\u0600-\u06FF]/;
const WORD_SPLIT_REGEX = /([^\p{L}\p{N}]+)/u;

// Urdu mappings
const URDU_CHARS: Record<string, string> = {
  "آ": "aa", "ا": "a", "أ": "a", "إ": "i",
  "ب": "b", "پ": "p", "ت": "t", "ٹ": "t", "ث": "s",
  "ج": "j", "چ": "ch", "ح": "h", "خ": "kh",
  "د": "d", "ڈ": "d", "ذ": "z",
  "ر": "r", "ڑ": "r", "ز": "z", "ژ": "zh",
  "س": "s", "ش": "sh", "ص": "s", "ض": "z",
  "ط": "t", "ظ": "z",
  "ع": "a", "غ": "gh",
  "ف": "f", "ق": "q",
  "ک": "k", "ك": "k", "گ": "g",
  "ل": "l", "م": "m", "ن": "n", "ں": "n",
  "و": "o",
  "ہ": "h", "ۂ": "h", "ۃ": "t", "ھ": "h",
  "ی": "i", "ي": "i", "ے": "e", "ۓ": "e",
  "ء": "", "ئ": "y",
};

const URDU_ASPIRATES: Record<string, string> = {
  "بھ": "bh", "پھ": "ph", "تھ": "th", "ٹھ": "th", "جھ": "jh", "چھ": "chh",
  "دھ": "dh", "ڈھ": "dh", "کھ": "kh", "گھ": "gh", "رھ": "rh", "ڑھ": "rh",
  "لھ": "lh", "مھ": "mh", "نھ": "nh",
};

// High-frequency Urdu / Coke Studio / Qawwali / Bollywood words
const URDU_LEXICON: Record<string, string> = {
  "قسمت": "qismat", "میں": "mein", "مری": "meri", "چین": "chain", "سے": "se",
  "جینا": "jeena", "لکھ": "likh", "دے": "de", "ڈوبے": "doobe", "نہ": "na",
  "کبھی": "kabhi", "میرا": "mera", "سفینہ": "safeena", "جنت": "jannat",
  "بھی": "bhi", "گوارا": "gawara", "ہے": "hai", "مگر": "magar", "میرے": "mere",
  "لئے": "liye", "لیے": "liye", "اے": "ae", "کاتب": "katib", "تقدیر": "taqdeer",
  "مدینہ": "madina", "تاجدار": "tajdar", "حرم": "haram", "ہو": "ho",
  "نگاہ": "nigah", "کرم": "karam", "ہم": "hum", "غریبوں": "ghareebon",
  "کے": "ke", "دن": "din", "سنور": "sanwar", "جائیں": "jayen", "گے": "ge",
  "حامی": "haami", "بے": "be", "کساں": "kasaan", "کیا": "kya", "کہے": "kahe",
  "گا": "ga", "جہاں": "jahan", "آپ": "aap", "در": "dar", "خالی": "khaali",
  "اگر": "agar", "کوئی": "koi", "اپنا": "apna", "نہیں": "nahin", "غم": "gham",
  "مارے": "maare", "ہیں": "hain", "پہ": "peh", "فریاد": "faryaad", "لائے": "laaye",
  "ورنہ": "warna", "چوکھٹ": "chaukhat", "کا": "ka", "نام": "naam", "لے": "le",
  "مر": "mar", "تم": "tum", "کہوں": "kahoon", "عرب": "arab", "کنور": "kanwar",
  "جانتے": "jaante", "من": "man", "کی": "ki", "بتیاں": "batiyan", "فرقت": "furqat",
  "تو": "tu", "امّی": "ummi", "لقب": "laqab", "کاٹے": "kaate", "کٹے": "kate",
  "اب": "ab", "رتیاں": "ratiyan", "توری": "tori", "پریت": "preet", "سدھ": "sudh",
  "بدھ": "budh", "سب": "sab", "بسری": "bisri", "کب": "kab", "تک": "tak",
  "یہ": "yeh", "رہیگی": "rahegi", "خبری": "khabri", "گاہے": "gaahe",
  "بفگن": "bafgan", "دزدیدہ": "duzdeeda", "نظر": "nazar", "سن": "sun",
  "لو": "lo", "ہمری": "hamri", "گیا": "gaya", "اپنے": "apne", "دامن": "daaman",
  "کو": "ko", "بھر": "bhar", "سوالی": "sawali", "حبیب": "habeeb", "حزیں": "hazeen",
  "پر": "par", "آقا": "aaqa", "اوراق": "auraaq", "ہستی": "hasti", "بکھر": "bikhar",
  "مے": "maye", "کشو": "kasho", "آؤ": "aao", "مدینے": "madine", "چلیں": "chalein",
  "اسی": "issi", "مہینے": "maheene", "تجلّیوں": "tajalliyon", "عجب": "ajab",
  "فضا": "faza", "شوق": "shauq", "انتہا": "inteha", "حیات": "hayaat",
  "خوف": "khauf", "قضا": "qaza", "نماز": "namaaz", "عشق": "ishq",
  "کریں": "karein", "ادا": "ada", "براہ": "baraah", "راست": "raast",
  "راہ": "raah", "خدا": "khuda", "دست": "dast", "ثاقی": "saaqi",
  "کوثر": "kausar", "پینے": "peene", "یاد": "yaad", "رکھو": "rakho",
  "اک": "ik", "اٹھ": "uth", "جتنے": "jitne", "جام": "jaam", "وہ": "woh",
  "طوفان": "toofan", "بجلیوں": "bijliyon", "ڈر": "dar", "سخت": "sakht",
  "مشکل": "mushkil", "کدھر": "kidhar", "ہی": "hi", "گر": "gar", "لیں": "lein",
  "ہماری": "hamaari", "خبر": "khabar", "مصیبت": "museebat", "یا": "ya",
  "مصطفیٰ": "mustafa", "مجتبیٰ": "mujtaba", "ارحم": "irham", "لنا": "lana",
  "تجھ": "tujh", "گل": "gul", "قسم": "qasam", "روشن": "roshan",
  "دل": "dil", "بات": "baat", "رات": "raat", "ساتھ": "saath", "یار": "yaar",
  "عاشق": "aashiq", "چاند": "chaand", "تارے": "taare", "محبت": "mohabbat",
  "آواز": "aawaaz", "تیری": "teri", "تیرا": "tera", "تیرے": "tere",
  "ہمیں": "humein", "تمہیں": "tumhein", "زندگی": "zindagi", "دعا": "dua",
  "کون": "kaun", "جا": "jaa", "رہا": "raha", "رہی": "rahi", "رہے": "rahe",
  "تھا": "tha", "تھی": "thi", "تھے": "the", "سنا": "suna", "کہا": "kaha",
  "دیکھ": "dekh", "دیکھا": "dekha", "آیا": "aaya", "آئی": "aayi", "آئے": "aaye",
  "بول": "bol", "سوچ": "soch", "جان": "jaan", "چاہ": "chaah", "چاہتا": "chahta",
};

function transliterateUrduWord(raw: string): string {
  if (!raw) return raw;
  let word = raw.trim();
  let izafat = false;

  // Izafat: word ends with Zer (\u0650) or He with Hamza (ۂ)
  if (word.endsWith("\u0650") || word.endsWith("ِ") || word.endsWith("ۂ")) {
    izafat = true;
    word = word.replace(/[\u0650ِۂ]$/, "");
  }

  // Strip non-letter diacritics for dictionary lookup
  const clean = word.replace(/[\u064B-\u065F\u0670]/g, "");

  if (URDU_LEXICON[clean]) return URDU_LEXICON[clean] + (izafat ? "-e" : "");
  if (URDU_LEXICON[word]) return URDU_LEXICON[word] + (izafat ? "-e" : "");

  let out = "";
  let i = 0;
  while (i < clean.length) {
    const pair = clean.slice(i, i + 2);
    if (URDU_ASPIRATES[pair]) {
      out += URDU_ASPIRATES[pair];
      i += 2;
      continue;
    }
    const ch = clean[i];
    if (URDU_CHARS[ch] !== undefined) {
      out += URDU_CHARS[ch];
    } else {
      out += ch;
    }
    i++;
  }

  // Polish end-of-word 'h' after consonant to 'a' (e.g. 'safeenh' -> 'safeena')
  if (out.length > 2 && out.endsWith("h") && !/[aeiouy]h$/i.test(out)) {
    out = out.slice(0, -1) + "a";
  }

  if (izafat) out += "-e";
  return out;
}

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

function transliterateIndicWord(word: string): string {
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
 * Romanize Indic (Devanagari, Gurmukhi) and Perso-Arabic (Urdu) lyrics;
 * English, Latin, numbers, and punctuation stay untouched byte-for-byte.
 */
export function romanizeLyrics(text: string): string {
  if (!text || !ROMANIZABLE_SCRIPT_REGEX.test(text)) return text;

  return text
    .split(WORD_SPLIT_REGEX)
    .map((token) => {
      if (INDIC_SCRIPT_REGEX.test(token)) {
        return transliterateIndicWord(token);
      }
      if (URDU_SCRIPT_REGEX.test(token)) {
        return transliterateUrduWord(token);
      }
      return token;
    })
    .join("");
}

export function hasRomanizableScript(text: string): boolean {
  return ROMANIZABLE_SCRIPT_REGEX.test(text);
}
