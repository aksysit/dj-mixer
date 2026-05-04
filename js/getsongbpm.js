// GetSongBPM-Client + Local-Cache.
//
// Wichtig: Im Browser-Kontext löst der Browser die Cloudflare-Bot-Challenge
// transparent (über das Cookie aus einem normalen Seitenbesuch). Wenn die
// erste Anfrage einen Cloudflare-Block sieht, kann der User einmalig manuell
// https://getsongbpm.com aufrufen — dadurch wird die clearance-Cookie gesetzt,
// und alle weiteren Fetches gehen durch.

import { parseClassicalKey, parseCamelot } from './camelot.js';

const CACHE_KEY = 'bpm_cache';
const RATE_LIMIT_MS = 220;          // ~5 req/s

let cacheLoaded = false;
let cache = {};
let pendingSave = null;

function loadCache() {
  if (cacheLoaded) return;
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    cache = {};
  }
  cacheLoaded = true;
}

function saveCache() {
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('Cache-Save fehlgeschlagen — möglicherweise Quota voll', e);
    }
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
  out.enrichedAt = entry.fetchedAt;
  out.source = 'getSongBPM';
  return out;
}

/**
 * Sucht BPM/Tonart für einen Track, zuerst im Cache, dann live.
 * Gibt einen angereicherten Track zurück (oder den Original-Track ohne Daten).
 */
export async function enrichTrack(track, apiKey) {
  loadCache();
  const key = lookupKey(track);

  if (cache[key]) {
    if (cache[key].notFound) return track;
    return applyToTrack(cache[key], track);
  }
  if (!apiKey) return track;

  const result = await fetchFromAPI(track.title, track.artist, apiKey);
  cache[key] = result;
  saveCache();

  if (result.notFound) return track;
  return applyToTrack(result, track);
}

/**
 * Reichert eine Liste von Tracks sequenziell an, ruft `progress(done, total)` auf.
 */
export async function enrichTracks(tracks, apiKey, progress) {
  const result = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.bpm != null && t.key != null) {
      result.push(t);
    } else {
      result.push(await enrichTrack(t, apiKey));
    }
    if (progress) progress(i + 1, tracks.length);
    await sleep(RATE_LIMIT_MS);
  }
  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sanitize(s) {
  return (s || '')
    .replace(/\(feat\..*?\)/gi, '')
    .replace(/\[feat\..*?\]/gi, '')
    .replace(/\(ft\..*?\)/gi, '')
    .replace(/\[ft\..*?\]/gi, '')
    .replace(/ - Remastered.*$/i, '')
    .replace(/ \(Remastered.*$/i, '')
    .replace(/ - Single Version.*$/i, '')
    .replace(/:/g, '')
    .trim();
}

async function fetchFromAPI(title, artist, apiKey) {
  const cleanTitle = sanitize(title);
  const cleanArtist = sanitize(artist);
  const lookup = `song:${cleanTitle} artist:${cleanArtist}`;
  const url = new URL('https://api.getsongbpm.com/search/');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('type', 'both');
  url.searchParams.set('lookup', lookup);

  const fetchedAt = Date.now();
  try {
    const resp = await fetch(url.toString(), {
      headers: { Accept: 'application/json' }
    });
    if (!resp.ok) {
      // 403 = Cloudflare-Block oder Auth-Problem — als notFound markieren,
      // damit wir nicht in jeder Session erneut anfragen.
      console.warn('GetSongBPM HTTP', resp.status, '— bitte einmalig getsongbpm.com im Browser aufrufen');
      return { notFound: true, fetchedAt };
    }
    const data = await resp.json();
    const hits = Array.isArray(data?.search) ? data.search : [];
    if (!hits.length) return { notFound: true, fetchedAt };
    const first = hits[0];
    const bpm = parseFloat(first.tempo);
    return {
      bpm: Number.isFinite(bpm) ? bpm : null,
      camelot: first.open_key || null,
      classicalKey: first.key_of || null,
      fetchedAt,
      notFound: false
    };
  } catch (e) {
    console.warn('GetSongBPM fetch error', e);
    return { notFound: true, fetchedAt };
  }
}
