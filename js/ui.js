// DOM-Rendering für DJ Mixer.
// Wird von app.js mit den notwendigen Callbacks initialisiert.

import * as state from './state.js';
import { camelotString, classicalString } from './camelot.js';
import { scoreClass } from './engine.js';

let callbacks = {};

export function init(cb) {
  callbacks = cb;
  bindEvents();
  subscribe();
  renderAll();
}

// ================= Event-Bindings =================

function bindEvents() {
  // Topbar
  $('provider-select').addEventListener('change', e => {
    state.patch({ activeProviderId: e.target.value, library: [], recommendations: [], nowPlaying: null });
    callbacks.onProviderChange?.();
  });
  $('connect-btn').addEventListener('click', () => callbacks.onConnect?.());
  $('enrich-btn').addEventListener('click', () => callbacks.onEnrich?.());
  $('settings-btn').addEventListener('click', () => openModal());
  $('local-import-btn').addEventListener('click', () => callbacks.onLocalImportPick?.());

  // Library
  $('search-input').addEventListener('input', e => {
    state.patch({ searchText: e.target.value });
  });
  $('library-picker-btn').addEventListener('click', () => callbacks.onOpenLibraryPicker?.());

  // Library-Picker-Modal
  document.querySelectorAll('[data-close-library-modal]').forEach(el =>
    el.addEventListener('click', closeLibraryModal)
  );
  $('lib-select-all').addEventListener('click', () => setAllLibChecks(true));
  $('lib-select-none').addEventListener('click', () => setAllLibChecks(false));
  $('lib-load-btn').addEventListener('click', () => callbacks.onLoadFromPicker?.(getSelectedLibSources()));

  // Suggestions
  $('wedding-mode-toggle').addEventListener('change', e => {
    state.patch({ weddingMode: e.target.checked });
    $('setting-wedding-mode').checked = e.target.checked;
    callbacks.onSettingsChange?.();
  });

  // Modal
  document.querySelectorAll('[data-close-modal]').forEach(el =>
    el.addEventListener('click', closeModal)
  );
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('spotify-client-id').addEventListener('change', e => {
    localStorage.setItem('spotify_client_id', e.target.value.trim());
  });
  $('tidal-client-id').addEventListener('change', e => {
    localStorage.setItem('tidal_client_id', e.target.value.trim());
  });
  $('tidal-country').addEventListener('change', e => {
    localStorage.setItem('tidal_country', e.target.value.trim().toUpperCase().slice(0, 2));
  });
  $('getsongbpm-key').addEventListener('change', e => {
    localStorage.setItem('getsongbpm_key', e.target.value.trim());
  });
  $('anthropic-key').addEventListener('change', e => {
    localStorage.setItem('anthropic_api_key', e.target.value.trim());
  });
  $('ai-mode-toggle').addEventListener('change', e => {
    state.patch({ aiMode: e.target.checked });
    callbacks.onAiToggle?.(e.target.checked);
  });
  $('setting-wedding-mode').addEventListener('change', e => {
    state.patch({ weddingMode: e.target.checked });
    $('wedding-mode-toggle').checked = e.target.checked;
    callbacks.onSettingsChange?.();
  });
  $('setting-bpm-deviation').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    state.patch({ maxBpmDeviation: v });
    $('bpm-dev-display').textContent = v;
    callbacks.onSettingsChange?.();
  });
  $('clear-cache-btn').addEventListener('click', () => callbacks.onClearCache?.());
  $('clear-negative-btn').addEventListener('click', () => callbacks.onClearNegativeCache?.());
}

// ================= Subscriptions =================

function subscribe() {
  state.on('change:library', () => renderLibrary());
  state.on('change:searchText', () => renderLibrary());
  state.on('change:nowPlaying', () => renderNowPlaying());
  state.on('change:recommendations', () => renderSuggestions());
  state.on('change:statusMessage', () => renderStatus());
  state.on('change:isWorking', () => renderStatus());
  state.on('change:enrichmentProgress', () => renderStatus());
  state.on('change:activeProviderId', () => renderTopbar());
}

// ================= Renders =================

function renderAll() {
  prefillSettings();
  updateRedirectDisplays();
  renderTopbar();
  renderLibrary();
  renderNowPlaying();
  renderSuggestions();
  renderStatus();
}

export function renderTopbar() {
  const s = state.get();
  $('provider-select').value = s.activeProviderId;
  const authed = callbacks.isAuthed?.() ?? false;
  $('connect-btn').textContent = authed ? 'Abmelden' : 'Verbinden';
  $('connect-btn').classList.toggle('primary', !authed);
  $('enrich-btn').disabled = s.library.length === 0 || s.isWorking;
}

export function renderLibrary() {
  const list = $('library-list');
  const tracks = state.filteredLibrary();
  $('library-count').textContent = `${tracks.length} / ${state.get().library.length} Songs`;

  if (state.get().library.length === 0) {
    list.innerHTML = `<div class="empty-state">Keine Songs geladen — verbinde dich mit Spotify oder Tidal.</div>`;
    return;
  }
  if (tracks.length === 0) {
    list.innerHTML = `<div class="empty-state">Kein Treffer für „${esc(state.get().searchText)}".</div>`;
    return;
  }

  // Performance: Bei großen Libraries nur die ersten 500 rendern.
  const slice = tracks.slice(0, 500);
  list.innerHTML = slice.map(t => trackRowHTML(t)).join('');
  list.querySelectorAll('.track-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      const track = state.get().library.find(x => x.id === id);
      if (track) callbacks.onSelectTrack?.(track);
    });
  });
}

function trackRowHTML(t) {
  const playing = state.get().nowPlaying?.id === t.id;
  const art = t.artworkUrl ? `style="background-image:url('${escAttr(t.artworkUrl)}')"` : '';
  return `
    <div class="track-row ${playing ? 'playing' : ''}" data-id="${escAttr(t.id)}">
      <div class="track-art" ${art}></div>
      <div class="track-meta">
        <div class="track-title">${esc(t.title)}</div>
        <div class="track-artist">${esc(t.artist)}</div>
      </div>
      <div class="track-stats">
        ${t.bpm != null ? `<div class="bpm">${Math.round(t.bpm)} BPM</div>` : ''}
        ${t.key ? `<div>${camelotString(t.key)}</div>` : ''}
      </div>
    </div>
  `;
}

export function renderNowPlaying() {
  const np = state.get().nowPlaying;
  const el = $('now-playing');
  if (!np) {
    el.className = 'empty-state';
    el.innerHTML = 'Wähle einen Song als „Now Playing".';
    return;
  }
  el.className = '';
  const art = np.artworkUrl ? `style="background-image:url('${escAttr(np.artworkUrl)}')"` : '';
  const bpm = np.bpm != null ? Math.round(np.bpm) : '—';
  const key = np.key ? camelotString(np.key) : '—';
  const keySub = np.key ? classicalString(np.key) : null;
  const energy = np.energy != null ? `${np.energy}/10` : '—';
  const genre = np.genre || '—';

  el.innerHTML = `
    <div class="np-art" ${art}></div>
    <h2 class="np-title">${esc(np.title)}</h2>
    <div class="np-artist">${esc(np.artist)}</div>
    ${np.album ? `<div class="np-album">${esc(np.album)}</div>` : ''}
    <div class="np-stats">
      <div>
        <div class="np-stat-label">BPM</div>
        <div class="np-stat-value">${bpm}</div>
      </div>
      <div>
        <div class="np-stat-label">Tonart</div>
        <div class="np-stat-value">${esc(key)}</div>
        ${keySub ? `<div class="np-stat-sub">${esc(keySub)}</div>` : ''}
      </div>
      <div>
        <div class="np-stat-label">Genre</div>
        <div class="np-stat-value" style="font-size:13px">${esc(genre)}</div>
      </div>
      <div>
        <div class="np-stat-label">Energy</div>
        <div class="np-stat-value">${energy}</div>
      </div>
    </div>
  `;
}

export function renderSuggestions() {
  const list = $('suggestions-list');
  const recs = state.get().recommendations;
  if (recs.length === 0) {
    list.innerHTML = `<div class="empty-state">Setze einen Song als „Now Playing" und reichere die Library mit BPM/Tonart an.</div>`;
    return;
  }
  list.innerHTML = recs.map(r => suggestionRowHTML(r)).join('');
  list.querySelectorAll('.suggestion-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      const track = state.get().library.find(x => x.id === id);
      if (track) callbacks.onSelectTrack?.(track);
    });
  });
}

function suggestionRowHTML(r) {
  const t = r.track;
  const art = t.artworkUrl ? `style="background-image:url('${escAttr(t.artworkUrl)}')"` : '';
  const bpmDelta = r.bpmDeltaPercent != null
    ? `${r.bpmDeltaPercent >= 0 ? '+' : ''}${r.bpmDeltaPercent.toFixed(1)}%` : null;
  const score = Math.round(r.totalScore * 100);
  return `
    <div class="suggestion-row" data-id="${escAttr(t.id)}">
      <div class="suggestion-art" ${art}></div>
      <div class="suggestion-meta">
        <div class="suggestion-title">${esc(t.title)}</div>
        <div class="suggestion-artist">${esc(t.artist)}</div>
        <div class="tag-row">
          ${t.bpm != null ? `<span class="tag"><span class="tag-strong">${Math.round(t.bpm)} BPM</span>${bpmDelta ? `<span class="tag-sub">${bpmDelta}</span>` : ''}</span>` : ''}
          ${t.key ? `<span class="tag"><span class="tag-strong">${camelotString(t.key)}</span><span class="tag-sub">${esc(r.keyTransitionLabel)}</span></span>` : ''}
          ${t.genre ? `<span class="tag">${esc(t.genre)}</span>` : ''}
        </div>
        ${r.aiReason ? `<div class="ai-reason">✨ ${esc(r.aiReason)}</div>` : ''}
      </div>
      <div class="score-badge ${scoreClass(r.totalScore)}">${score}</div>
    </div>
  `;
}

export function renderStatus() {
  const s = state.get();
  $('status-text').textContent = s.statusMessage;
  const bar = $('progress-bar');
  if (s.enrichmentProgress) {
    bar.hidden = false;
    bar.max = s.enrichmentProgress.total;
    bar.value = s.enrichmentProgress.done;
  } else {
    bar.hidden = true;
  }
  $('enrich-btn').disabled = s.library.length === 0 || s.isWorking;
}

// ================= Modal =================

function openModal() {
  prefillSettings();
  updateRedirectDisplays();
  $('cache-count').textContent = callbacks.cacheCount?.() ?? '0';
  $('settings-modal').hidden = false;
}

function closeModal() {
  $('settings-modal').hidden = true;
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name)
  );
  document.querySelectorAll('.tab-pane').forEach(p =>
    p.classList.toggle('active', p.dataset.pane === name)
  );
}

function prefillSettings() {
  $('spotify-client-id').value = localStorage.getItem('spotify_client_id') || '';
  $('tidal-client-id').value = localStorage.getItem('tidal_client_id') || '';
  $('tidal-country').value = localStorage.getItem('tidal_country') || 'DE';
  $('getsongbpm-key').value = localStorage.getItem('getsongbpm_key') || '';
  $('anthropic-key').value = localStorage.getItem('anthropic_api_key') || '';
  $('setting-wedding-mode').checked = state.get().weddingMode;
  $('wedding-mode-toggle').checked = state.get().weddingMode;
  $('ai-mode-toggle').checked = state.get().aiMode;
  $('setting-bpm-deviation').value = state.get().maxBpmDeviation;
  $('bpm-dev-display').textContent = state.get().maxBpmDeviation;
}

function updateRedirectDisplays() {
  $('spotify-redirect-display').textContent =
    new URL('callback-spotify.html', window.location.href).toString();
  $('tidal-redirect-display').textContent =
    new URL('callback-tidal.html', window.location.href).toString();
}

// ================= Library Picker Modal =================

/**
 * Wird aus app.js aufgerufen, wenn die Quellen-Liste vom Provider geladen ist.
 * sources: Array von { id, name, count, artworkUrl, kind: 'liked'|'playlist' }
 */
export function showLibraryPicker(sources) {
  const list = $('lib-source-list');
  list.innerHTML = sources.map(s => `
    <label class="lib-source-row">
      <input type="checkbox" data-source-id="${escAttr(s.id)}" data-kind="${s.kind}" checked>
      <div class="lib-source-art" ${s.artworkUrl ? `style="background-image:url('${escAttr(s.artworkUrl)}')"` : ''}></div>
      <div class="lib-source-meta">
        <div class="lib-source-name">${esc(s.name)}</div>
        <div class="lib-source-count">${s.count != null ? s.count + ' Tracks' : ''}</div>
      </div>
    </label>
  `).join('');
  $('lib-modal-status').textContent = `${sources.length} Quellen verfügbar — wähle aus, was in die Library soll.`;
  $('library-modal').hidden = false;
}

export function closeLibraryModal() {
  $('library-modal').hidden = true;
}

export function setLibraryPickerStatus(text) {
  $('lib-modal-status').textContent = text;
}

function setAllLibChecks(checked) {
  document.querySelectorAll('#lib-source-list input[type=checkbox]').forEach(cb => {
    cb.checked = checked;
  });
}

function getSelectedLibSources() {
  const out = [];
  document.querySelectorAll('#lib-source-list input[type=checkbox]:checked').forEach(cb => {
    out.push({ id: cb.dataset.sourceId, kind: cb.dataset.kind });
  });
  return out;
}

// ================= Helpers =================

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escAttr(s) { return esc(s); }
