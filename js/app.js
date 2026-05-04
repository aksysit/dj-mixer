// DJ Mixer — Hauptmodul. Wired State, UI und Provider zusammen.

import * as state from './state.js';
import * as ui from './ui.js';
import { spotify } from './providers/spotify.js';
import { tidal } from './providers/tidal.js';
import { recommend } from './engine.js';
import { enrichTrack, enrichTracks, cacheCount, clearCache, clearNegativeCache } from './getsongbpm.js';

const PROVIDERS = { spotify, tidal };

function activeProvider() {
  return PROVIDERS[state.get().activeProviderId] || spotify;
}

function isAuthed() {
  return activeProvider().isAuthenticated();
}

ui.init({
  isAuthed,
  cacheCount,

  onProviderChange() {
    state.patch({ statusMessage: `Provider: ${activeProvider().displayName}` });
    ui.renderTopbar();
  },

  async onConnect() {
    const p = activeProvider();
    if (p.isAuthenticated()) {
      await p.signOut();
      state.patch({ library: [], nowPlaying: null, recommendations: [], statusMessage: `${p.displayName} abgemeldet.` });
      ui.renderTopbar();
      return;
    }
    try {
      await p.authorize();   // führt Redirect durch
    } catch (e) {
      state.patch({ statusMessage: e.message });
    }
  },

  async onEnrich() {
    const apiKey = localStorage.getItem('getsongbpm_key');
    if (!apiKey) {
      state.patch({ statusMessage: 'Bitte zuerst GetSongBPM-API-Key in den Einstellungen eintragen.' });
      return;
    }
    const lib = state.get().library;
    if (lib.length === 0) {
      state.patch({ statusMessage: 'Library ist leer — zuerst laden.' });
      return;
    }
    state.patch({ isWorking: true, statusMessage: 'Reichere Library an…' });
    const enriched = await enrichTracks(lib, apiKey, (done, total) => {
      state.patch({ enrichmentProgress: { done, total }, statusMessage: `Reichere an: ${done}/${total}` });
    });
    const withData = enriched.filter(t => t.bpm != null).length;
    state.patch({
      library: enriched,
      isWorking: false,
      enrichmentProgress: null,
      statusMessage: `Anreicherung fertig: ${withData}/${enriched.length} Tracks haben jetzt BPM/Key.`
    });
    recomputeRecommendations();
  },

  async onLoadPlaylists() {
    const p = activeProvider();
    if (!p.isAuthenticated()) {
      state.patch({ statusMessage: `Bitte zuerst ${p.displayName} verbinden.` });
      return;
    }
    state.patch({ isWorking: true, statusMessage: 'Lade Playlists…' });
    const lists = await p.loadPlaylists();
    state.patch({ playlists: lists, isWorking: false });
    if (lists.length === 0) {
      state.patch({ statusMessage: 'Keine Playlists gefunden.' });
      return;
    }
    // Einfache Auswahl per prompt — bei Bedarf später als hübsches Modal.
    const choice = window.prompt(
      `Welche Playlist laden? (Nummer 1-${lists.length})\n` +
      lists.map((p, i) => `${i + 1}. ${p.name} (${p.trackCount ?? '?'} Tracks)`).join('\n')
    );
    const idx = parseInt(choice, 10) - 1;
    if (Number.isFinite(idx) && lists[idx]) {
      state.patch({ isWorking: true, statusMessage: `Lade „${lists[idx].name}"…` });
      const tracks = await p.loadTracksInPlaylist(lists[idx].id);
      state.patch({
        library: tracks,
        isWorking: false,
        statusMessage: `${tracks.length} Songs aus „${lists[idx].name}" geladen.`,
        nowPlaying: null,
        recommendations: []
      });
    } else {
      state.patch({ statusMessage: 'Abgebrochen.' });
    }
  },

  async onSelectTrack(track) {
    state.patch({ nowPlaying: track });
    if (track.bpm == null || track.key == null) {
      const apiKey = localStorage.getItem('getsongbpm_key');
      if (apiKey) {
        const enriched = await enrichTrack(track, apiKey);
        // Library-Eintrag aktualisieren
        const lib = state.get().library.map(t => t.id === enriched.id ? enriched : t);
        state.patch({ library: lib, nowPlaying: enriched });
      }
    }
    recomputeRecommendations();
  },

  onSettingsChange() {
    recomputeRecommendations();
  },

  onClearCache() {
    if (confirm('Den kompletten BPM-Cache wirklich löschen?')) {
      clearCache();
      state.patch({ statusMessage: 'Cache gelöscht.' });
    }
  },

  onClearNegativeCache() {
    clearNegativeCache();
    state.patch({ statusMessage: 'Negativ-Cache gelöscht.' });
  }
});

function recomputeRecommendations() {
  const s = state.get();
  if (!s.nowPlaying || s.nowPlaying.bpm == null) {
    state.patch({ recommendations: [] });
    return;
  }
  const recs = recommend(s.library, s.nowPlaying, {
    maxBpmDeviation: s.maxBpmDeviation,
    weddingMode: s.weddingMode,
    maxResults: 12
  });
  state.patch({
    recommendations: recs,
    statusMessage: `${recs.length} Vorschläge berechnet.`
  });
}

// Initiale Library nach erfolgreichem OAuth automatisch laden
async function autoLoadIfAuthed() {
  const p = activeProvider();
  if (!p.isAuthenticated()) return;
  state.patch({ isWorking: true, statusMessage: `Lade ${p.displayName}-Bibliothek…` });
  const lib = await p.loadLibrary(500);
  state.patch({
    library: lib,
    isWorking: false,
    statusMessage: `Bibliothek geladen: ${lib.length} Songs.`
  });
  ui.renderTopbar();
}
autoLoadIfAuthed();
