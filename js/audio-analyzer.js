// Client-Side BPM-Analyse aus 30-Sekunden-Previews.
//
// Strategie: Spotify und iTunes liefern für die meisten Tracks eine kostenlose,
// DRM-freie 30-Sek-MP3-Preview. Wir laden die im Browser, decodieren mit der
// Web Audio API und bestimmen das BPM mit web-audio-beat-detector.
//
// Genauigkeit ~80–90% für Pop/Charts/Wedding. Falsche Ergebnisse können in
// der UI manuell überschrieben werden.

import { analyze } from 'https://cdn.jsdelivr.net/npm/web-audio-beat-detector@8.2.7/+esm';

let _ctx;
function audioContext() {
  if (!_ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    _ctx = new Ctx();
  }
  return _ctx;
}

/**
 * Lädt eine Preview-MP3 und bestimmt BPM via Web Audio API.
 * @param {string} previewUrl
 * @returns {Promise<{bpm: number}>}
 */
export async function analyzePreview(previewUrl) {
  if (!previewUrl) throw new Error('Keine Preview-URL.');
  const resp = await fetch(previewUrl);
  if (!resp.ok) throw new Error(`Preview-Download fehlgeschlagen: HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const audio = await audioContext().decodeAudioData(buf);
  const bpm = await analyze(audio);
  return { bpm: bpm };
}

/**
 * Sucht eine Track-Preview über iTunes (als Fallback, wenn Spotify keine URL liefert).
 * iTunes Search API: kostenlos, kein Auth, sehr breite Track-Abdeckung.
 */
export async function findITunesPreview(artist, title) {
  if (!artist || !title) return null;
  const term = `${artist} ${title}`;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=3&country=DE`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.results || data.results.length === 0) return null;
    // Beste Übereinstimmung: erstes Ergebnis ist oft der populärste Match.
    return data.results[0]?.previewUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Analysiert einen Track. Versucht zuerst die Spotify-Preview, dann iTunes.
 * Gibt einen angereicherten Track-Patch zurück: { bpm, source, enrichedAt }
 * — oder wirft, wenn keine Quelle Daten liefert.
 */
export async function analyzeTrack(track) {
  // 1. Spotify-Preview probieren
  let previewUrl = track.previewUrl || null;
  let usedSource = 'spotify-preview';

  // 2. iTunes-Fallback
  if (!previewUrl) {
    previewUrl = await findITunesPreview(track.artist, track.title);
    usedSource = 'itunes-preview';
  }
  if (!previewUrl) {
    throw new Error('Keine Preview-Quelle gefunden.');
  }

  const result = await analyzePreview(previewUrl);
  return {
    bpm: result.bpm,
    key: null,             // Tonart-Analyse liefert die Lib (noch) nicht zuverlässig
    source: usedSource,
    enrichedAt: Date.now()
  };
}
