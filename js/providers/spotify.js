// Spotify Web API Provider — kompatibel mit dem MusicProvider-Interface.

import * as oauth from '../oauth.js';

const REDIRECT_URI = redirectUri();
const AUTHORIZE = 'https://accounts.spotify.com/authorize';
const TOKEN     = 'https://accounts.spotify.com/api/token';
const API_BASE  = 'https://api.spotify.com/v1';
const SCOPES    = [
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative'
];

function redirectUri() {
  // Egal ob lokal (z.B. http://localhost:8000) oder GitHub Pages —
  // Redirect ist immer das callback-Dokument neben index.html.
  return new URL('callback-spotify.html', window.location.href).toString();
}

function config() {
  const clientId = localStorage.getItem('spotify_client_id') || '';
  return {
    clientId,
    authorizeEndpoint: AUTHORIZE,
    tokenEndpoint: TOKEN,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES
  };
}

export const spotify = {
  id: 'spotify',
  displayName: 'Spotify',
  redirectUri: REDIRECT_URI,

  isAuthenticated() {
    return !!oauth.loadToken('spotify');
  },

  authorize() {
    return oauth.startAuthorize('spotify', config());
  },

  async signOut() {
    oauth.clearToken('spotify');
  },

  async loadLibrary(limit = 500) {
    const token = await oauth.ensureValidToken('spotify', config());
    if (!token) return [];
    const collected = [];
    let url = `${API_BASE}/me/tracks?limit=50`;
    while (url && collected.length < limit) {
      const data = await fetchJSON(url, token);
      if (!data) break;
      for (const item of data.items || []) {
        if (item.track) collected.push(toTrack(item.track));
      }
      url = data.next;
    }
    return collected.slice(0, limit);
  },

  async loadPlaylists() {
    const token = await oauth.ensureValidToken('spotify', config());
    if (!token) return [];
    const result = [];
    let url = `${API_BASE}/me/playlists?limit=50`;
    while (url) {
      const data = await fetchJSON(url, token);
      if (!data) break;
      for (const p of data.items || []) {
        result.push({
          id: p.id,
          name: p.name,
          trackCount: p.tracks?.total ?? null,
          artworkUrl: p.images?.[0]?.url ?? null,
          providerId: 'spotify'
        });
      }
      url = data.next;
    }
    return result;
  },

  async loadTracksInPlaylist(playlistId) {
    const token = await oauth.ensureValidToken('spotify', config());
    if (!token) return [];
    const collected = [];
    let url = `${API_BASE}/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`;
    while (url) {
      const data = await fetchJSON(url, token);
      if (!data) break;
      for (const item of data.items || []) {
        if (item.track) collected.push(toTrack(item.track));
      }
      url = data.next;
    }
    return collected;
  },

  async searchCatalog(term, limit = 25) {
    if (!term) return [];
    const token = await oauth.ensureValidToken('spotify', config());
    if (!token) return [];
    const url = `${API_BASE}/search?q=${encodeURIComponent(term)}&type=track&limit=${Math.min(limit, 50)}`;
    const data = await fetchJSON(url, token);
    return (data?.tracks?.items || []).map(toTrack);
  }
};

async function fetchJSON(url, token) {
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    if (!resp.ok) {
      console.warn('Spotify fetch fehlgeschlagen', resp.status, url);
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.warn('Spotify network error', e);
    return null;
  }
}

function toTrack(s) {
  if (!s || !s.id) return null;
  return {
    id: `spotify:${s.id}`,
    title: s.name,
    artist: s.artists?.[0]?.name ?? 'Unbekannt',
    album: s.album?.name ?? null,
    durationSeconds: s.duration_ms ? s.duration_ms / 1000 : null,
    genre: null,                       // Spotify hat Genre nur auf Artist-Ebene
    artworkUrl: s.album?.images?.[0]?.url ?? null,
    bpm: null,
    key: null,
    energy: null,
    source: 'spotify',
    enrichedAt: null
  };
}
