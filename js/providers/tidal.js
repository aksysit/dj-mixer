// Tidal Provider — über die Tidal Developer Platform (openapi.tidal.com).
//
// Hinweis: Tidals OpenAPI v2 verwendet JSON:API als Format. Die Endpoints
// werden weiterhin gelegentlich angepasst — wenn was zickt, in der Doku
// auf https://developer.tidal.com nachschauen.

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
    const userId = await fetchUserId(token);
    if (!userId) return [];
    const cc = countryCode();
    const url = `${API_BASE}/users/${userId}/favorites/tracks?countryCode=${cc}&include=tracks&limit=${limit}`;
    const resp = await fetchJsonApi(url, token);
    return parseTracks(resp);
  },

  async loadPlaylists() {
    const token = await oauth.ensureValidToken('tidal', config());
    if (!token) return [];
    const userId = await fetchUserId(token);
    if (!userId) return [];
    const cc = countryCode();
    const url = `${API_BASE}/users/${userId}/playlists?countryCode=${cc}&limit=50`;
    const resp = await fetchJsonApi(url, token);
    if (!resp) return [];
    const arr = Array.isArray(resp.data) ? resp.data : (resp.data ? [resp.data] : []);
    return arr
      .filter(item => item.type === 'playlists')
      .map(item => ({
        id: item.id,
        name: item.attributes?.name ?? 'Unbenannt',
        trackCount: item.attributes?.numberOfItems ?? null,
        artworkUrl: item.attributes?.imageLinks?.[0]?.href ?? null,
        providerId: 'tidal'
      }));
  },

  async loadTracksInPlaylist(playlistId) {
    const token = await oauth.ensureValidToken('tidal', config());
    if (!token) return [];
    const cc = countryCode();
    const url = `${API_BASE}/playlists/${encodeURIComponent(playlistId)}?countryCode=${cc}&include=items`;
    const resp = await fetchJsonApi(url, token);
    return parseTracks(resp);
  },

  async searchCatalog(term, limit = 25) {
    if (!term) return [];
    const token = await oauth.ensureValidToken('tidal', config());
    if (!token) return [];
    const cc = countryCode();
    const url = `${API_BASE}/searchresults/${encodeURIComponent(term)}/relationships/tracks?countryCode=${cc}&include=tracks&limit=${limit}`;
    const resp = await fetchJsonApi(url, token);
    return parseTracks(resp);
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
      console.warn('Tidal fetch fehlgeschlagen', resp.status, url);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.warn('Tidal network error', e);
    return null;
  }
}

async function fetchUserId(token) {
  const cc = countryCode();
  const url = `${API_BASE}/users/me?countryCode=${cc}`;
  const resp = await fetchJsonApi(url, token);
  return resp?.data?.id ?? null;
}

function parseTracks(resp) {
  if (!resp || !resp.included) return [];
  const tracks = [];
  for (const item of resp.included) {
    if (item.type !== 'tracks' || !item.attributes) continue;
    tracks.push({
      id: `tidal:${item.id}`,
      title: item.attributes.title ?? '—',
      artist: item.attributes.artists?.[0]?.name ?? 'Unbekannt',
      album: item.attributes.album ?? null,
      durationSeconds: parseDuration(item.attributes.duration),
      genre: null,
      artworkUrl: item.attributes.imageLinks?.[0]?.href ?? null,
      bpm: null,
      key: null,
      energy: null,
      source: 'tidal',
      enrichedAt: null
    });
  }
  return tracks;
}

/** Mini-Parser für ISO-8601 Durations wie "PT3M21S". */
function parseDuration(iso) {
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
