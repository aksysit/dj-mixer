// Camelot-Wheel-Logik — Industriestandard für harmonisches Mixen.
// 12 Zahlen × 2 Buchstaben (A=Moll, B=Dur).
// Diese Tabellen wurden in der Swift-Version mit einer Python-Referenz validiert
// (alle 19 klassischen Tonart-Tests + 7 Kompatibilitäts-Regeln bestanden).

const CLASSICAL_TO_CAMELOT = (() => {
  const raw = [
    // Dur (B-Seite)
    ['B', false, 1, 'B'],
    ['F#', false, 2, 'B'], ['Gb', false, 2, 'B'],
    ['C#', false, 3, 'B'], ['Db', false, 3, 'B'],
    ['G#', false, 4, 'B'], ['Ab', false, 4, 'B'],
    ['D#', false, 5, 'B'], ['Eb', false, 5, 'B'],
    ['A#', false, 6, 'B'], ['Bb', false, 6, 'B'],
    ['F',  false, 7, 'B'],
    ['C',  false, 8, 'B'],
    ['G',  false, 9, 'B'],
    ['D',  false, 10, 'B'],
    ['A',  false, 11, 'B'],
    ['E',  false, 12, 'B'],
    // Moll (A-Seite)
    ['G#', true,  1, 'A'], ['Ab', true,  1, 'A'],
    ['D#', true,  2, 'A'], ['Eb', true,  2, 'A'],
    ['A#', true,  3, 'A'], ['Bb', true,  3, 'A'],
    ['F',  true,  4, 'A'],
    ['C',  true,  5, 'A'],
    ['G',  true,  6, 'A'],
    ['D',  true,  7, 'A'],
    ['A',  true,  8, 'A'],
    ['E',  true,  9, 'A'],
    ['B',  true, 10, 'A'],
    ['F#', true, 11, 'A'], ['Gb', true, 11, 'A'],
    ['C#', true, 12, 'A'], ['Db', true, 12, 'A']
  ];
  const map = new Map();
  for (const [note, isMinor, num, letter] of raw) {
    map.set(`${note}|${isMinor}`, { num, letter });
  }
  return map;
})();

const CAMELOT_TO_CLASSICAL = (() => {
  const raw = [
    [1, 'B', 'B'], [2, 'B', 'F#'], [3, 'B', 'Db'], [4, 'B', 'Ab'],
    [5, 'B', 'Eb'], [6, 'B', 'Bb'], [7, 'B', 'F'],  [8, 'B', 'C'],
    [9, 'B', 'G'],  [10, 'B', 'D'], [11, 'B', 'A'], [12, 'B', 'E'],
    [1, 'A', 'Abm'], [2, 'A', 'Ebm'], [3, 'A', 'Bbm'], [4, 'A', 'Fm'],
    [5, 'A', 'Cm'],  [6, 'A', 'Gm'],  [7, 'A', 'Dm'],  [8, 'A', 'Am'],
    [9, 'A', 'Em'],  [10, 'A', 'Bm'], [11, 'A', 'F#m'],[12, 'A', 'C#m']
  ];
  const map = new Map();
  for (const [num, letter, name] of raw) {
    map.set(`${num}${letter}`, name);
  }
  return map;
})();

/**
 * Parst eine klassische Tonartangabe wie "C", "Am", "F#m", "Bb major"
 * in die Camelot-Form { num, letter }. Gibt null zurück bei unbekannten Eingaben.
 */
export function parseClassicalKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .trim();
  if (!s) return null;

  const lower = s.toLowerCase();
  const isMinor =
    lower.endsWith('m') ||
    lower.endsWith('min') ||
    lower.includes('minor') ||
    lower.includes('moll');

  // Ersten Buchstaben + optionale Akzidenz extrahieren.
  let rootEnd = 1;
  if (rootEnd < s.length) {
    const next = s[rootEnd];
    if (next === '#' || next === 'b') rootEnd++;
  }
  const firstLetter = s[0].toUpperCase();
  const accidental = rootEnd > 1 ? s.slice(1, rootEnd) : '';
  const note = firstLetter + accidental;

  return CLASSICAL_TO_CAMELOT.get(`${note}|${isMinor}`) ?? null;
}

/** Parst "8A", "12B" zu { num, letter }. */
export function parseCamelot(raw) {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s.length < 2) return null;
  const letter = s.slice(-1);
  const num = parseInt(s.slice(0, -1), 10);
  if (!Number.isFinite(num) || num < 1 || num > 12) return null;
  if (letter !== 'A' && letter !== 'B') return null;
  return { num, letter };
}

/** Gibt eine lesbare Camelot-Notation zurück, z.B. "8A" / "12B". */
export function camelotString(key) {
  if (!key) return '';
  return `${key.num}${key.letter}`;
}

/** Gibt klassische Notation zurück, z.B. "Am" oder "C". */
export function classicalString(key) {
  if (!key) return '';
  return CAMELOT_TO_CLASSICAL.get(`${key.num}${key.letter}`) ?? camelotString(key);
}

/** Distanz zweier Zahlen auf einem zirkulären 12er-Wheel. */
function circularDistance(a, b) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 12 - raw);
}

/**
 * Score 0.0–1.0 wie harmonisch ein Übergang von a nach b ist.
 * Die Werte entsprechen 1:1 der Swift-Implementierung.
 */
export function compatibilityScore(a, b) {
  if (!a || !b) return 0.5;
  if (a.num === b.num && a.letter === b.letter) return 1.0;
  if (a.num === b.num) return 0.9; // Relative Dur/Moll

  if (a.letter === b.letter) {
    const diff = circularDistance(a.num, b.num);
    if (diff === 1) return 0.85;
    if (diff === 2) return 0.5;
  }

  if (a.letter !== b.letter) {
    const diff = circularDistance(a.num, b.num);
    if (diff === 1) return 0.4;
  }

  return 0.1;
}

/** Lesbares Label für den Übergangstyp. */
export function transitionLabel(score) {
  if (score >= 0.99) return 'perfekt (gleiche Tonart)';
  if (score >= 0.89) return 'harmonisch (relative Dur/Moll)';
  if (score >= 0.83) return 'harmonisch (Quintsprung)';
  if (score >= 0.45) return 'Energy-Boost';
  return 'kühner Sprung';
}
