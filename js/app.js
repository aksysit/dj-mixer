// DJ Mixer — Hauptmodul. Wired State, UI und Provider zusammen.

import * as state from './state.js';
import * as ui from './ui.js';
import { spotify } from './providers/spotify.js';
import { tidal } from './providers/tidal.js';
import { recommend } from './engine.js';
import { enrichTrack, enrichTracks, cacheCount, clearCache, clearNegativeCache } from './getsongbpm.js';
import { rerank as aiRerank } from './ai.js';
import { importFromFiles, pickFolder, installDropZone } from './local-import.js';

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

  async onOpenLibraryPicker() {
    const p = activeProvider();
    if (!p.isAuthenticated()) {
      state.patch({ statusMessage: `Bitte zuerst ${p.displayName} verbinden.` });
      return;
    }
    state.patch({ isWorking: true, statusMessage: 'Lade Quellen-Liste…' });
    const lists = await p.loadPlaylists();
    state.patch({ playlists: lists, isWorking: false });
    // Als Quellen anbieten: zuerst Liked Songs, dann alle Playlists.
    const sources = [
      { id: '__liked__', kind: 'liked', name: '❤️  Liked Songs', count: null, artworkUrl: null },
      ...lists.map(pl => ({ id: pl.id, kind: 'playlist', name: pl.name, count: pl.trackCount, artworkUrl: pl.artworkUrl }))
    ];
    state.patch({ statusMessage: `${sources.length} Quellen verfügbar.` });
    ui.showLibraryPicker(sources);
  },

  async onLoadFromPicker(selected) {
    if (!selected || selected.length === 0) {
      state.patch({ statusMessage: 'Mindestens eine Quelle auswählen.' });
      return;
    }
    ui.closeLibraryModal();
    const p = activeProvider();
    state.patch({ isWorking: true, statusMessage: `Lade ${selected.length} Quellen…`, library: [], nowPlaying: null, recommendations: [] });

    // Sequenziell (parallele Calls riskieren Spotifys Rate-Limit).
    const allTracks = [];
    let done = 0;
    for (const src of selected) {
      done++;
      state.patch({ statusMessage: `Lade Quelle ${done}/${selected.length}…`, enrichmentProgress: { done, total: selected.length } });
      let tracks = [];
      if (src.kind === 'liked') {
        tracks = await p.loadLibrary(2000);
      } else {
        tracks = await p.loadTracksInPlaylist(src.id);
      }
      allTracks.push(...tracks);
    }

    // Dedup nach Track-ID — gleiche Songs in mehreren Playlists nur einmal halten.
    const seen = new Map();
    for (const t of allTracks) {
      if (!seen.has(t.id)) seen.set(t.id, t);
    }
    const merged = Array.from(seen.values());
    state.patch({
      library: merged,
      isWorking: false,
      enrichmentProgress: null,
      statusMessage: `${merged.length} eindeutige Songs aus ${selected.length} Quellen geladen.`
    });
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

  onAiToggle() {
    // Reagiert auf das ✨ AI-Toggle in der Suggestions-Header.
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
  },

  async onLocalImportPick() {
    const files = await pickFolder();
    if (!files || files.length === 0) {
      state.patch({ statusMessage: 'Kein Ordner gewählt.' });
      return;
    }
    await runLocalImport(files);
  }
});

async function runLocalImport(files) {
  state.patch({
    isWorking: true,
    statusMessage: `Lokale Files werden importiert (${files.length} gefunden)…`,
    enrichmentProgress: { done: 0, total: files.length }
  });
  const tracks = await importFromFiles(files, (done, total, name) => {
    state.patch({
      enrichmentProgress: { done, total },
      statusMessage: `Analysiere lokal: ${done}/${total}` + (name ? ` — ${name.slice(0, 40)}` : '')
    });
  });
  // Mit bestehender Library mergen, dedup nach lookupKey (artist+title)
  const existing = state.get().library;
  const seen = new Map();
  for (const t of [...existing, ...tracks]) {
    const k = `${(t.artist || '').toLowerCase().trim()} - ${(t.title || '').toLowerCase().trim()}`;
    // Lokale Tracks bevorzugen (haben akkuratere BPM aus voller Track-Länge)
    if (!seen.has(k) || t.source === 'local') seen.set(k, t);
  }
  const merged = Array.from(seen.values());
  state.patch({
    library: merged,
    isWorking: false,
    enrichmentProgress: null,
    statusMessage: `Lokal-Import fertig: ${tracks.length} neue Tracks. Library: ${merged.length} Songs total.`
  });
}

// Drag&Drop überall im Fenster aktivieren
installDropZone(document.body, async (files) => {
  document.getElementById('drop-overlay').hidden = true;
  await runLocalImport(files);
});

// Overlay sichtbar machen wenn Files reingezogen werden
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  document.getElementById('drop-overlay').hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    document.getElementById('drop-overlay').hidden = true;
  }
});
window.addEventListener('drop', () => {
  dragDepth = 0;
  document.getElementById('drop-overlay').hidden = true;
});

async function recomputeRecommendations() {
  const s = state.get();
  if (!s.nowPlaying || s.nowPlaying.bpm == null) {
    state.patch({ recommendations: [] });
    return;
  }
  // Schritt 1: Algorithmische Top-30-Vorauswahl (instant, keine Wartezeit).
  const baseRecs = recommend(s.library, s.nowPlaying, {
    maxBpmDeviation: s.maxBpmDeviation,
    weddingMode: s.weddingMode,
    maxResults: 30
  });
  // Sofort die ersten 12 zeigen, damit der DJ nicht wartet.
  state.patch({
    recommendations: baseRecs.slice(0, 12),
    statusMessage: `${baseRecs.length} Kandidaten berechnet${s.aiMode ? ' — AI rankt…' : '.'}`
  });

  // Schritt 2: Wenn AI-Modus an, mit Haiku neu ranken.
  if (s.aiMode) {
    const apiKey = localStorage.getItem('anthropic_api_key');
    if (!apiKey) {
      state.patch({ statusMessage: 'AI-Modus an, aber kein Anthropic-Key. In Einstellungen eintragen.' });
      return;
    }
    if (baseRecs.length === 0) return;
    try {
      const refined = await aiRerank(baseRecs, s.nowPlaying, {
        weddingMode: s.weddingMode,
        maxResults: 10
      });
      // Nur übernehmen, wenn der aktuell laufende Track noch derselbe ist
      // (Race-Condition-Schutz, falls der User schon weitergeklickt hat).
      if (state.get().nowPlaying?.id === s.nowPlaying.id) {
        state.patch({
          recommendations: refined,
          statusMessage: `✨ AI-Ranking fertig (${refined.length} Vorschläge).`
        });
      }
    } catch (e) {
      state.patch({ statusMessage: `AI-Reranking fehlgeschlagen: ${e.message}` });
    }
  }
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
