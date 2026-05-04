// Zentraler Anwendungsstatus mit einfachem Pub/Sub.
// Komponenten subscriben mit on(event, fn), Änderungen via patch().

const subscribers = new Map(); // event → Set<fn>

const state = {
  library: [],
  nowPlaying: null,
  recommendations: [],
  playlists: [],

  activeProviderId: localStorage.getItem('activeProviderId') || 'spotify',
  searchText: '',

  weddingMode: localStorage.getItem('weddingMode') !== 'false',
  maxBpmDeviation: parseFloat(localStorage.getItem('maxBpmDeviation') || '8'),

  isWorking: false,
  statusMessage: 'Bereit. Bitte zuerst Provider verbinden.',
  enrichmentProgress: null   // {done, total} oder null
};

export function get() { return state; }

export function patch(updates) {
  Object.assign(state, updates);
  // Persistente Felder
  if ('activeProviderId' in updates) {
    localStorage.setItem('activeProviderId', state.activeProviderId);
  }
  if ('weddingMode' in updates) {
    localStorage.setItem('weddingMode', String(state.weddingMode));
  }
  if ('maxBpmDeviation' in updates) {
    localStorage.setItem('maxBpmDeviation', String(state.maxBpmDeviation));
  }
  emit('change', state);
  for (const k of Object.keys(updates)) emit(`change:${k}`, state[k]);
}

export function on(event, fn) {
  if (!subscribers.has(event)) subscribers.set(event, new Set());
  subscribers.get(event).add(fn);
  return () => subscribers.get(event).delete(fn);
}

function emit(event, payload) {
  const subs = subscribers.get(event);
  if (subs) for (const fn of subs) {
    try { fn(payload); } catch (e) { console.error('Subscriber error:', e); }
  }
}

/** Filter-Logik der Library */
export function filteredLibrary() {
  const term = state.searchText.trim().toLowerCase();
  if (!term) return state.library;
  return state.library.filter(t =>
    t.title.toLowerCase().includes(term) ||
    t.artist.toLowerCase().includes(term) ||
    (t.album || '').toLowerCase().includes(term)
  );
}
