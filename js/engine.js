// Recommendation-Engine — exakter JS-Port der Swift-Engine.
// total = 0.45·BPM + 0.30·Key + 0.15·Energy + 0.10·Genre

import { compatibilityScore, transitionLabel } from './camelot.js';

const DEFAULT_WEIGHTS = {
  bpm: 0.45,
  key: 0.30,
  energy: 0.15,
  genre: 0.10
};

/**
 * Berechnet Top-N Empfehlungen.
 * @param {Track[]} pool — alle verfügbaren Tracks
 * @param {Track} current — aktuell laufender Track
 * @param {object} settings — { maxBpmDeviation, weddingMode, maxResults }
 */
export function recommend(pool, current, settings = {}) {
  const cfg = {
    maxBpmDeviation: settings.maxBpmDeviation ?? 8,
    weddingMode: settings.weddingMode ?? true,
    maxResults: settings.maxResults ?? 12
  };
  if (!current || current.bpm == null) return [];

  const scored = [];
  for (const cand of pool) {
    if (cand.id === current.id) continue;
    const r = scoreSingle(cand, current, cfg);
    if (r) scored.push(r);
  }
  scored.sort((a, b) => b.totalScore - a.totalScore);
  return scored.slice(0, cfg.maxResults);
}

function scoreSingle(cand, current, cfg) {
  if (cand.bpm == null) return null;

  // 1. BPM
  const delta = (cand.bpm - current.bpm) / current.bpm * 100; // in %
  const absDelta = Math.abs(delta);
  const maxDev = cfg.weddingMode ? cfg.maxBpmDeviation + 4 : cfg.maxBpmDeviation;
  let bpmScore = absDelta >= maxDev ? 0 : Math.max(0, 1 - absDelta / maxDev);
  // Doppel-/halbe-BPM bonus
  bpmScore = Math.max(bpmScore, doubleHalfMatch(current.bpm, cand.bpm));

  // 2. Key
  let keyScore = 0.5;
  let keyLabel = 'Tonart unbekannt';
  if (current.key && cand.key) {
    keyScore = compatibilityScore(current.key, cand.key);
    keyLabel = transitionLabel(keyScore);
  }

  // 3. Energy
  let energyScore = 0.5;
  if (current.energy != null && cand.energy != null) {
    const diff = Math.abs(current.energy - cand.energy);
    energyScore = Math.max(0, 1 - diff / 9);
  }

  // 4. Genre
  let genreScore = 0.5;
  if (current.genre && cand.genre) {
    if (current.genre.toLowerCase() === cand.genre.toLowerCase()) {
      genreScore = 1.0;
    } else {
      genreScore = cfg.weddingMode ? 0.6 : 0.2;
    }
  }

  const total =
    bpmScore   * DEFAULT_WEIGHTS.bpm +
    keyScore   * DEFAULT_WEIGHTS.key +
    energyScore* DEFAULT_WEIGHTS.energy +
    genreScore * DEFAULT_WEIGHTS.genre;

  return {
    track: cand,
    totalScore: total,
    bpmScore, keyScore, energyScore, genreScore,
    bpmDeltaPercent: delta,
    keyTransitionLabel: keyLabel
  };
}

/** Erkennt halben/doppelten Tempo-Match, z.B. 70 vs 140 BPM. */
function doubleHalfMatch(a, b) {
  for (const ratio of [0.5, 2.0]) {
    const target = a * ratio;
    const dev = Math.abs(target - b) / target * 100;
    if (dev < 5) return 0.85;
  }
  return 0;
}

/** Hilfsfunktion zur Score-Klassifikation für UI-Farben. */
export function scoreClass(score) {
  if (score >= 0.8) return 'score-good';
  if (score >= 0.6) return 'score-okay';
  if (score >= 0.4) return 'score-meh';
  return 'score-bad';
}
