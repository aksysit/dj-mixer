// BPM-Anreicherung — neue Implementierung mit Client-Side Audio-Analyse.
//
// Statt einer fragilen API-Anbindung (Cloudflare-Block, CORS, etc.) laden wir
// 30-Sek-Previews von Spotify/iTunes direkt in den Browser, decodieren mit
// Web Audio API und bestimmen das BPM lokal.
//
// Die externe API dieses Moduls (enrichTrack, enrichTracks, cacheCount, …)
// bleibt gleich, damit der Rest der App nicht angefasst werden muss.

import { analyzeTrack } from './audio-analyzer.js';
import { parseClassicalKey, parseCamelot } from './camelot.js';

const CACHE_KEY = 'bpm_cache';
const CONCURRENCY = 3;        // 3 parallele Audio-Analysen — stabil im Browser
const RATE_LIMIT_MS = 50;     // kurze Pause, damit der Audio-Context nicht erstickt

let cacheLoaded = false;
let cache = {};
let pendingSave = null;

function loadCache() {
  if (cacheLoaded) return;
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { cache = {}; }
  cacheLoaded = true;
}

function saveCache() {
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = setTimeout(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
    catch (e) { console.warn('Cache-Save fehlgeschlagen:', e); }
    pendingSave = null;
  }, 800);
}

export function cacheCount() {
  loadCache();
  return Object.keys(cache).length;
}
export function clearCache() {
  cache = {};
  localStorage.removeItem(CACHE_KEY);
}
export function clearNegativeCache() {
  loadCache();
  for (const key of Object.keys(cache)) {
    if (cache[key].notFound) delete cache[key];
  }
  saveCache();
}

function lookupKey(track) {
  return `${(track.artist || '').toLowerCase().trim()} - ${(track.title || '').toLowerCase().trim()}`;
}

function applyToTrack(entry, track) {
  const out = { ...track };
  if (entry.bpm != null) out.bpm = entry.bpm;
  if (entry.camelot) {
    const k = parseCamelot(entry.camelot);
    if (k) out.key = k;
  } else if (entry.classicalKey) {
    const k = parseClassicalKey(entry.classicalKey);
    if (k) out.key = k;
  }
  if (entry.energy != null) out.energy = entry.energy;
  out.enrichedAt = entry.fetchedAt;
  out.source = entry.source || 'audio-analysis';
  return out;
}

/**
 * Reichert einen einzelnen Track an. Liest aus Cache, analysiert sonst
 * die Preview-Audio.
 *
 * Der zweite Parameter "apiKey" wird ignoriert — bleibt nur in der Signatur
 * damit der Rest der App nicht angefasst werden muss.
 */
export async function enrichTrack(track, _apiKey) {
  loadCache();
  const key = lookupKey(track);
  const cached = cache[key];
  if (cached) {
    if (cached.notFound) return track;
    return applyToTrack(cached, track);
  }

  try {
    const result = await analyzeTrack(track);
    const entry = {
      bpm: Number.isFinite(result.bpm) ? result.bpm : null,
      camelot: null,
      classicalKey: null,
      energy: null,
      lookupKey: key,
      fetchedAt: Date.now(),
      notFound: false,
      source: result.source || 'audio-analysis'
    };
    cache[key] = entry;
    saveCache();
    return applyToTrack(entry, track);
  } catch (e) {
    // Track konnte nicht analysiert werden (keine Preview, decodier-Fehler) —
    // ins Negativ-Cache schreiben, damit wir den Track nicht in Endlosschleife
    // erneut probieren. User kann den Negativ-Cache in den Settings leeren.
    cache[key] = {
      bpm: null, camelot: null, classicalKey: null, energy: null,
      lookupKey: key, fetchedAt: Date.now(), notFound: true,
      reason: e.message || String(e)
    };
    saveCache();
    return track;
  }
}

/**
 * Reichert eine Liste von Tracks an. Mit beschränkter Parallelität, damit
 * der Browser-Audio-Context nicht überlastet wird.
 */
export async function enrichTracks(tracks, _apiKey, progress) {
  const result = new Array(tracks.length);
  let done = 0;
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tracks.length) return;
      const t = tracks[i];
      if (t.bpm != null) {
        result[i] = t;
      } else {
        result[i] = await enrichTrack(t);
        if (RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS);
      }
      done++;
      if (progress) progress(done, tracks.length);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
