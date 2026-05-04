// Tidal Provider — über die Tidal Developer Platform (openapi.tidal.com).
//
// Aktuelle v2-API-Endpoints (Stand 2026, JSON:API-Format):
//   - User-Info aus JWT-Token (sub-Claim)
//   - Library-Tracks: /userCollectionTracks/{userId}?include=items
//   - User-Playlists: /playlists?filter[owners.id]={userId}
//   - Playlist-Tracks: /playlists/{id}/relationships/items?include=items
//   - Search: /searchResults/{query}/relationships/tracks?include=tracks

import * as oauth from '../oauth.js';

const REDIRECT_URI = new URL('callback-tidal.html', window.location.href).toString();
const AUTHORIZE = 'https://login.tidal.com/authorize';
const TOKEN     = 'https://auth.tidal.com/v1/oauth2/token';
const API_BASE  = 'https://openapi.tidal.com/v2';
const SCOPES    = [
  'collection.read',
  'playlists.read',
  'search.read',
  'user.read'
];

function config() {
  const clientId = localStorage.getItem('tidal_client_id') || '';
  return {
    clientId,
    authorizeEndpoint: AUTHORIZE,
    tokenEndpoint: TOKEN,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES
  };
}

function countryCode() {
  return localStorage.getItem('tidal_country') || 'DE';
}

/** Extrahiert die User-ID aus einem JWT-Access-Token. */
function getUserIdFromToken(token) {
  try {
    const parts = token.access_token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    // Tidal-JWTs benutzen meist `uid` oder `sub`.
    return String(payload.uid || payload.sub || '').replace(/[^0-9a-zA-Z-]/g, '') || null;
  } catch (e) {
    console.warn('Tidal: User-ID aus Token nicht extrahierbar', e);
    return null;
  }
}

export const tidal = {
  id: 'tidal',
  displayName: 'Tidal',
  redirectUri: REDIRECT_URI,

  isAuthenticated() {
    return !!oauth.loadToken('tidal');
  },

  authorize() {
    return oauth.startAuthorize('tidal', config());
  },

  async signOut() {
    oauth.clearToken('tidal');
  },

  async loadLibrary(limit = 500) {
    const token = await oauth.ensureValidToken('tidal', config());
    if (!token) return [];
    const userId = getUserIdFromToken(token);
    if (!userId) {
      console.warn('Tidal: keine User-ID im Token gefunden');
      return [];
    }
    const cc = countryCode();

    // userCollectionTracks/{userId} mit include=items lädt die Tracks-Collection
    // und hängt die referenzierten Tracks als "included" an.
    const url = `${API_BASE}/userCollectionTracks/${userId}?countryCode=${cc}&include=items&limit=${limit}`;
    const resp = await fetchJsonApi(url, token);
    return parseTracksFromIncluded(resp);
  },

  async loadPlaylists() {
    const token = await oauth.ensureValidToken('tidal', config());
    if (!token) return [];
    const userId = getUserIdFromToken(token);
    if (!userId) return [];
    const cc = countryCode();

    // Eigene Playlists (vom User erstellt) via filter auf owners.id
    const url = `${API_BASE}/playlists?countryCode=${cc}&filter[owners.id]=${userId}&include=coverArt&limit=50`;
    const resp = await fetchJsonApi(url, token);
    if (!resp || !resp.data) return [];
    const arr = Array.isArray(resp.data) ? resp.data : [resp.data];
    const includedById = indexIncluded(resp.included);
    return arr
      .filter(item => item.type === 'playlists')
      .map(item => ({
        id: item.id,
        name: item.attributes?.name ?? 'Unbenannt',
        trackCount: item.attributes?.numberOfItems ?? null,
        artworkUrl: extractCoverUrl(item, includedById),
        providerId: 'tidal'
      }));
  },

  async loadTracksInPlaylist(playlistId) {
    const token = await oauth.ensureValidToken('tidal', config());
    if (!token) return [];
    const cc = countryCode();
    // /playlists/{id}?include=items inkludiert die Tracks/Videos der Playlist.
    const url = `${API_BASE}/playlists/${encodeURIComponent(playlistId)}?countryCode=${cc}&include=items`;
    const resp = await fetchJsonApi(url, token);
    return parseTracksFromIncluded(resp);
  },

  async searchCatalog(term, limit = 25) {
    if (!term) return [];
    const token = await oauth.ensureValidToken('tidal', config());
    if (!token) return [];
    const cc = countryCode();
    // Tidals SearchResult-Resource: ID = die normalisierte Query
    const url = `${API_BASE}/searchResults/${encodeURIComponent(term)}/relationships/tracks?countryCode=${cc}&include=tracks&limit=${limit}`;
    const resp = await fetchJsonApi(url, token);
    return parseTracksFromIncluded(resp);
  }
};

async function fetchJsonApi(url, token) {
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.api+json'
      }
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.warn('Tidal fetch fehlgeschlagen', resp.status, url, body.slice(0, 200));
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.warn('Tidal network error', url, e);
    return null;
  }
}

/**
 * JSON:API liefert Tracks als "included"-Resources, wenn man include=items
 * oder include=tracks angibt. Diese Funktion zieht alle Tracks raus und
 * konvertiert sie ins App-Modell.
 */
function parseTracksFromIncluded(resp) {
  if (!resp || !resp.included) return [];
  const includedById = indexIncluded(resp.included);
  const tracks = [];
  for (const item of resp.included) {
    if (item.type !== 'tracks' || !item.attributes) continue;
    const a = item.attributes;
    tracks.push({
      id: `tidal:${item.id}`,
      title: a.title ?? '—',
      artist: extractArtistName(item, includedById),
      album: extractAlbumName(item, includedById),
      durationSeconds: parseISO8601Duration(a.duration),
      genre: null,
      artworkUrl: extractCoverUrl(item, includedById),
      bpm: null,
      key: null,
      energy: null,
      source: 'tidal',
      enrichedAt: null
    });
  }
  return tracks;
}

/** Indexiert die included-Resources nach "type:id" für Lookups. */
function indexIncluded(included) {
  const map = new Map();
  if (!included) return map;
  for (const r of included) map.set(`${r.type}:${r.id}`, r);
  return map;
}

function extractArtistName(track, includedById) {
  // Tidals Tracks haben relationships.artists.data: [{type, id}, ...]
  const refs = track.relationships?.artists?.data;
  if (!refs || refs.length === 0) return 'Unbekannt';
  const first = includedById.get(`${refs[0].type}:${refs[0].id}`);
  return first?.attributes?.name ?? 'Unbekannt';
}

function extractAlbumName(track, includedById) {
  const refs = track.relationships?.albums?.data;
  if (!refs || refs.length === 0) return null;
  const first = includedById.get(`${refs[0].type}:${refs[0].id}`);
  return first?.attributes?.title ?? null;
}

function extractCoverUrl(resource, includedById) {
  // Tidals Resource hat relationships.coverArt.data: [{type:'artworks', id}]
  const refs = resource.relationships?.coverArt?.data;
  if (!refs || refs.length === 0) return null;
  const arr = Array.isArray(refs) ? refs : [refs];
  const art = includedById.get(`${arr[0].type}:${arr[0].id}`);
  // Artworks haben mehrere Files in attributes.files mit url + size
  const files = art?.attributes?.files;
  if (Array.isArray(files) && files.length > 0) {
    // Mittlere Größe bevorzugen (~320px)
    const target = files.find(f => f.meta?.width >= 256 && f.meta?.width <= 640) || files[0];
    return target?.href ?? null;
  }
  return null;
}

/** Mini-Parser für ISO-8601 Durations wie "PT3M21S". */
function parseISO8601Duration(iso) {
  if (!iso || typeof iso !== 'string') return null;
  let mins = 0, secs = 0, current = '';
  for (const ch of iso) {
    if (/[0-9.]/.test(ch)) {
      current += ch;
    } else if (ch === 'M') {
      mins = parseFloat(current) || 0;
      current = '';
    } else if (ch === 'S') {
      secs = parseFloat(current) || 0;
      current = '';
    } else {
      current = '';
    }
  }
  return mins * 60 + secs;
}
